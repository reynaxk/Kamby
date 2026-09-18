import { Injectable } from '@nestjs/common';
import type { ChainSlug } from '@kamby/domain';
import { parseGwei } from 'viem';
import { PinoLogger } from 'nestjs-pino';
import { EvmRelayerNonceManagerService } from './evm-relayer-nonce-manager.service';
import { EvmRelayerWalletService } from './evm-relayer-wallet.service';

export interface RelayedTransactionRequest {
  to: string;
  data: string;
  value: bigint;
}

export type EvmRelayerSimulationResult = { ok: true; gasUnits: bigint } | { ok: false; reason: string };

export type EvmRelayerCeilingCheckResult =
  | { ok: true; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; totalCostWei: bigint }
  | { ok: false; reason: string };

export interface EvmRelayerBroadcastResult {
  txHash: string;
  nonce: number;
}

/**
 * The EVM gas relayer's core mechanics — not yet reachable via any HTTP route (that's
 * sub-piece 4d, `EvmGasRelayerQuoteService` + `POST /trade/relay`). See
 * docs/GAS_RELAYER_PLAN.md's EVM section for the full design; this class owns exactly
 * three things, always run in this order by the caller: `simulate` (the pre-broadcast
 * `eth_call` dry run — no gas spent on a revert), `checkGasCeiling` (the hard cost
 * backstop, run only once `simulate` has already confirmed success), and `broadcast`
 * (sign + submit, serialized per chain via `EvmRelayerNonceManagerService`). This class
 * deliberately never re-derives *what* to broadcast from a client request — every caller
 * is responsible for having already re-derived `{to, data, value}` from a persisted
 * `TradeQuote` row (never trusted from the request) and, before sub-piece 4d wires this
 * up for real, for having verified the EIP-712 consent signature and
 * `transactionMatchesQuote` gate described in that doc.
 */
@Injectable()
export class EvmGasRelayerService {
  constructor(
    private readonly wallet: EvmRelayerWalletService,
    private readonly nonceManager: EvmRelayerNonceManagerService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('EvmGasRelayerService');
  }

  /** `false` for every chain this deployment's relayer doesn't cover — mirrors
   *  `EvmRelayerWalletService#forChain`'s own "no silent default" contract. */
  isConfigured(chain: ChainSlug): boolean {
    return this.wallet.forChain(chain) !== null;
  }

  /**
   * The pre-broadcast `eth_call` dry run — the direct analogue of Solana's
   * `simulateTransaction`, and this relayer's mitigation for reverts costing real,
   * non-refundable gas once actually broadcast (no Solana equivalent). Deliberately
   * simulates as `account: <the relayer's own address>`, never the user's wallet: this is
   * a dry run of the transaction exactly as it will really be broadcast
   * (`msg.sender = relayer`), and a user-perspective simulation could miss router logic
   * that behaves differently depending on who the real broadcaster is — the pre-broadcast
   * simulation has to match the pre-broadcast reality it stands in for, or it isn't really
   * testing anything. A rejection here costs only RPC compute — nothing is ever broadcast.
   */
  async simulate(chain: ChainSlug, tx: RelayedTransactionRequest): Promise<EvmRelayerSimulationResult> {
    const clients = this.requireChain(chain);
    const shared = { account: clients.account, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: tx.value };
    try {
      await clients.publicClient.call(shared);
      const gasUnits = await clients.publicClient.estimateGas(shared);
      return { ok: true, gasUnits };
    } catch (error) {
      this.logger.warn({ chain, err: error }, 'pre-broadcast simulation rejected — nothing was broadcast, no gas spent');
      return { ok: false, reason: error instanceof Error ? error.message : 'simulation failed' };
    }
  }

  /**
   * The hard cost backstop — takes the gas estimate `simulate` already produced (never
   * re-simulates) and checks it against two independent ceilings: a gas-*price* ceiling
   * (network congestion) and a total-*cost* ceiling (`gasUnits × price`, the direct
   * analogue of `SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING`). The price ceiling alone isn't
   * enough — a technically-successful call that happens to consume an unusually large
   * number of gas units would pass a price-only check while still draining the relayer.
   * Running this only once `simulate` has already confirmed success mirrors the exact
   * mistake this whole design is built to avoid repeating: trusting "simulation
   * succeeded" to mean "safe to pay for" is the same shape of error as the WSOL
   * rent-redirect incident trusting "instruction shape matched" to mean "safe to
   * redirect" — see docs/GAS_RELAYER_PLAN.md's "applying the Piece 3 incident lesson".
   * Real per-chain ceiling *values* are deliberately not guessed here or anywhere in this
   * codebase — they come from `EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_<SLUG>`/
   * `EVM_GAS_RELAYER_MAX_WEI_CEILING_<SLUG>`, set from real adversarial-pass data.
   */
  async checkGasCeiling(chain: ChainSlug, gasUnits: bigint): Promise<EvmRelayerCeilingCheckResult> {
    const clients = this.requireChain(chain);
    const { maxFeePerGas, maxPriorityFeePerGas } = await clients.publicClient.estimateFeesPerGas();
    const priceCeilingWei = parseGwei(clients.maxGasPriceGwei.toString());

    if (maxFeePerGas > priceCeilingWei) {
      return {
        ok: false,
        reason: `estimated maxFeePerGas (${maxFeePerGas} wei) exceeds the configured ceiling of ${clients.maxGasPriceGwei} gwei for ${chain} — network is likely congested, try again shortly`,
      };
    }

    const totalCostWei = gasUnits * maxFeePerGas;
    const totalCostCeilingWei = BigInt(clients.maxWeiCeiling);
    if (totalCostWei > totalCostCeilingWei) {
      return {
        ok: false,
        reason: `estimated total cost (${totalCostWei} wei) exceeds the configured ceiling of ${totalCostCeilingWei} wei for ${chain}`,
      };
    }

    return { ok: true, maxFeePerGas, maxPriorityFeePerGas, totalCostWei };
  }

  /**
   * Signs and broadcasts a transaction the caller has already run through `simulate` and
   * `checkGasCeiling` successfully — this method does not re-run either check itself
   * (the ceiling check already needs the simulated gas estimate as an input, so the
   * ordering is the caller's responsibility, not something this method could self-enforce
   * without silently redoing work). Nonce acquisition, signing, and submission all happen
   * inside `EvmRelayerNonceManagerService#runExclusive` — see that class's own doc comment
   * for exactly what "serialized" means here (submission order only, never confirmation
   * order).
   */
  async broadcast(
    chain: ChainSlug,
    tx: RelayedTransactionRequest,
    fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
    gasUnits: bigint,
  ): Promise<EvmRelayerBroadcastResult> {
    const clients = this.requireChain(chain);
    return this.nonceManager.runExclusive(chain, async () => {
      const nonce = await clients.publicClient.getTransactionCount({ address: clients.account.address, blockTag: 'pending' });
      const txHash = await clients.walletClient.sendTransaction({
        account: clients.account,
        chain: clients.chain,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: tx.value,
        nonce,
        gas: gasUnits,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      this.logger.info({ chain, nonce, txHash }, 'relayed transaction broadcast');
      return { txHash, nonce };
    });
  }

  private requireChain(chain: ChainSlug) {
    const clients = this.wallet.forChain(chain);
    if (!clients) throw new Error(`EVM gas relayer is not configured for chain "${chain}"`);
    return clients;
  }
}
