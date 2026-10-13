import { ForbiddenException, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, SOLANA_USDC_MINT } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { EvmGasTopupService } from '../trading/evm-gas-topup.service';
import { RELAY_CHAIN_ID, RelayClient, RelayError, type BridgeChain, type RelayQuote, type RelayStatus, type RelayTxItem } from './relay-client';

/** USDC on each chain Kamby moves between (BNB Chain's USDC has 18 decimals). */
const USDC: Record<BridgeChain, { address: string; decimals: number }> = {
  base: { address: EVM_USDC_BY_CHAIN_ID[8453]!.address, decimals: EVM_USDC_BY_CHAIN_ID[8453]!.decimals },
  bnb: { address: EVM_USDC_BY_CHAIN_ID[56]!.address, decimals: EVM_USDC_BY_CHAIN_ID[56]!.decimals },
  solana: { address: SOLANA_USDC_MINT, decimals: 6 },
};

/** Smallest move worth making — below this the bridge fee is most of it. */
const MIN_MOVE_USD = 0.5;

export interface BridgeEvmStep {
  id: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  gas: string | null;
}

export interface BridgeQuoteDto {
  requestId: string;
  from: BridgeChain;
  to: BridgeChain;
  /** Raw USDC leaving the origin chain (origin decimals). */
  amountIn: string;
  /** Raw USDC arriving on the destination chain (destination decimals). */
  amountOut: string;
  /** Everything the move costs, in USD (Relay's fees + origin gas). */
  feeUsd: number;
  timeEstimateSeconds: number;
  /** The transactions the user's wallet signs, in order (EVM origins: approve, then deposit). */
  steps: BridgeEvmStep[];
}

/**
 * Moves a user's own USDC between their own Kamby wallets on Solana, Base and BNB Chain —
 * the "one USDC" model (owner, 2026-10-13): when a buy needs more USDC on a coin's chain than
 * the wallet holds there, the app moves the shortfall from another chain first.
 *
 * Phase 1 moves out of Base/BNB only (the user signs ordinary EVM transactions; Kamby's gas
 * tank funds their gas). Moves out of Solana need Kamby's relayer to pay the Solana fee and
 * get their own instruction allowlist first — phase 2.
 *
 * The destination is always one of the caller's own verified wallets, never a client-supplied
 * address, so a buggy or hostile client can't route a user's funds anywhere else.
 */
@Injectable()
export class BridgeService {
  private readonly relay: RelayClient;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
    @Optional() private readonly gasTopup?: EvmGasTopupService,
    @Optional() relay?: RelayClient,
  ) {
    this.relay = relay ?? new RelayClient(config.get('RELAY_API_KEY', { infer: true }) ?? null);
    this.logger.setContext('BridgeService');
  }

  async quote(userId: string, params: { from: BridgeChain; to: BridgeChain; amountOut: string }): Promise<BridgeQuoteDto> {
    const { from, to } = params;
    if (from === to) throw new UnprocessableEntityException('Pick two different chains');
    if (from === 'solana') throw new UnprocessableEntityException('Moving USDC out of Solana is coming soon');
    if (!/^\d+$/.test(params.amountOut) || BigInt(params.amountOut) <= 0n) throw new UnprocessableEntityException('Enter an amount');
    const outUsd = Number(BigInt(params.amountOut)) / 10 ** USDC[to].decimals;
    if (outUsd < MIN_MOVE_USD) throw new UnprocessableEntityException(`Moves start at $${MIN_MOVE_USD.toFixed(2)}`);

    const wallets = await prisma.wallet.findMany({ where: { userId, verifiedAt: { not: null } }, select: { address: true, chain: true } });
    const evm = wallets.find((w) => w.chain === 'EVM')?.address;
    const solana = wallets.find((w) => w.chain === 'SOLANA')?.address;
    const walletOn = (chain: BridgeChain) => (chain === 'solana' ? solana : evm);
    const user = walletOn(from);
    const recipient = walletOn(to);
    if (!user || !recipient) throw new ForbiddenException('Set up your wallet on both chains first');

    let quote: RelayQuote;
    try {
      quote = await this.relay.quote({
        user,
        recipient,
        originChainId: RELAY_CHAIN_ID[from],
        destinationChainId: RELAY_CHAIN_ID[to],
        originCurrency: USDC[from].address,
        destinationCurrency: USDC[to].address,
        amount: params.amountOut,
        tradeType: 'EXACT_OUTPUT',
      });
    } catch (error) {
      this.logger.warn({ err: error, from, to }, 'bridge quote failed');
      throw new UnprocessableEntityException(error instanceof RelayError ? `Couldn't prepare the move: ${error.message}` : "Couldn't prepare the move — try again");
    }

    const steps = toEvmSteps(quote, RELAY_CHAIN_ID[from], user, USDC[from].address);
    const requestId = quote.requestId ?? (quote.steps[0] as { requestId?: string } | undefined)?.requestId;
    if (!requestId) throw new UnprocessableEntityException("Couldn't prepare the move — try again");

    // The user pays the origin chain's gas from Kamby's gas tank, like any EVM trade.
    if (this.gasTopup) {
      await this.gasTopup.ensureGas(RELAY_CHAIN_ID[from], user, USDC[from]).catch((error: unknown) => {
        this.logger.warn({ err: error, from }, 'gas top-up before a move failed — the wallet may already have gas');
      });
    }

    return {
      requestId: String(requestId),
      from,
      to,
      amountIn: quote.details?.currencyIn?.amount ?? '0',
      amountOut: quote.details?.currencyOut?.amount ?? params.amountOut,
      feeUsd: feeUsd(quote),
      timeEstimateSeconds: quote.details?.timeEstimate ?? 10,
      steps,
    };
  }

  async status(requestId: string): Promise<{ status: RelayStatus }> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) throw new UnprocessableEntityException('Unknown move');
    try {
      return { status: await this.relay.status(requestId) };
    } catch {
      return { status: 'unknown' };
    }
  }
}

/** Exported for tests. Relay's steps for an EVM origin, checked: transactions only, all on the
 *  origin chain, sent from the user's own wallet, no native value attached (USDC moves
 *  carry none), and an approve may only ever target the origin's USDC contract. */
export function toEvmSteps(quote: RelayQuote, originChainId: number, user: string, usdcAddress: string): BridgeEvmStep[] {
  const steps: BridgeEvmStep[] = [];
  for (const step of quote.steps) {
    if (step.kind !== 'transaction') throw new UnprocessableEntityException('Unexpected step in the move — nothing was sent');
    for (const item of step.items) {
      const data = item.data as RelayTxItem;
      if (data.chainId !== originChainId) throw new UnprocessableEntityException('The move would run on the wrong chain — nothing was sent');
      if (data.from && data.from.toLowerCase() !== user.toLowerCase()) throw new UnprocessableEntityException('The move was prepared for a different wallet — nothing was sent');
      if (BigInt(data.value || '0') !== 0n) throw new UnprocessableEntityException('The move asked for more than USDC — nothing was sent');
      if (step.id === 'approve' && data.to.toLowerCase() !== usdcAddress.toLowerCase()) {
        throw new UnprocessableEntityException('The move asked to approve something other than USDC — nothing was sent');
      }
      steps.push({ id: step.id, to: data.to, data: data.data, value: '0', chainId: data.chainId, gas: data.gas ?? null });
    }
  }
  if (steps.length === 0) throw new UnprocessableEntityException("Couldn't prepare the move — try again");
  return steps;
}

/** Exported for tests. Everything the move costs the user, in USD. */
export function feeUsd(quote: RelayQuote): number {
  const usd = (key: string) => Number(quote.fees[key]?.amountUsd ?? 0) || 0;
  return Math.max(0, usd('relayer') + usd('gas') + usd('app'));
}
