import { createEvmTransport } from '@kamby/chain-adapters';
import { createPublicClient, isAddress } from 'viem';
import type { Logger } from 'pino';

export interface EvmRelayerBalanceCheckResult {
  label: string;
  wei: bigint | null;
  belowThreshold: boolean;
}

/**
 * Periodic, read-only balance check for this workers deployment's EVM gas relayer
 * fee-payer wallet — see docs/GAS_RELAYER_PLAN.md's EVM section, "4h — rollout." Mirrors
 * `solana/treasury-balance-monitor.ts`'s own reasoning exactly: a small, manually-funded
 * operational wallet that never auto-refills, so without this the first sign it ran dry
 * would be user-facing sponsored-trade failures with no advance warning — a real, named gap
 * the EVM relayer didn't have a counterpart for until now.
 *
 * Deliberately scoped to this deployment's own single chain, not a multi-chain map:
 * `apps/workers` runs one process per EVM chain (its own `CHAIN_RPC_URL`/`CHAIN_IDENTIFIER`
 * — see `main.ts`), unlike `apps/api`'s single multi-chain process, so the relayer's
 * fee-payer address is only ever checked against the one chain this worker already watches.
 *
 * Takes only the relayer's public key, never its secret key — this process, like every
 * other workers ticker, never holds signing capability for an operational wallet; a balance
 * read needs none. Reuses `createEvmTransport` (the same fallback-capable transport every
 * other read-only caller in this codebase uses) rather than a bespoke client — this is a
 * plain `eth_getBalance` read, not a broadcast, so none of `EvmRelayerWalletService`'s own
 * "never `createEvmTransport` for the wallet client" reasoning applies here.
 */
export async function checkEvmRelayerBalance(
  rpcUrl: string,
  rpcUrlFallback: string | null,
  relayerPublicKey: string,
  warnThresholdWei: bigint,
  logger: Logger,
): Promise<EvmRelayerBalanceCheckResult> {
  const label = 'evm-gas-relayer';
  if (!isAddress(relayerPublicKey)) {
    logger.error({ label, relayerPublicKey }, 'EVM gas relayer balance check failed — configured public key is not a valid address');
    return { label, wei: null, belowThreshold: false };
  }
  try {
    const client = createPublicClient({ transport: createEvmTransport(rpcUrl, rpcUrlFallback) });
    const wei = await client.getBalance({ address: relayerPublicKey });
    const belowThreshold = wei < warnThresholdWei;
    if (belowThreshold) {
      logger.warn(
        { label, relayerPublicKey, wei: wei.toString(), warnThresholdWei: warnThresholdWei.toString() },
        'EVM gas relayer balance is below its warning threshold — top up soon',
      );
    } else {
      logger.info({ label, wei: wei.toString() }, 'EVM gas relayer balance check');
    }
    return { label, wei, belowThreshold };
  } catch (error) {
    logger.error({ err: error, label, relayerPublicKey }, 'EVM gas relayer balance check failed — will retry next tick');
    return { label, wei: null, belowThreshold: false };
  }
}
