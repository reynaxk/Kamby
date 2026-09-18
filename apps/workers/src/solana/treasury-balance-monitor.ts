import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { Logger } from 'pino';

export interface MonitoredWallet {
  /** Human-readable name for logs only — e.g. "solana-topup-funding", "solana-gas-relayer". */
  label: string;
  publicKey: string;
  warnThresholdLamports: number;
}

export interface TreasuryBalanceCheckResult {
  label: string;
  lamports: number | null;
  belowThreshold: boolean;
}

/**
 * Periodic, read-only balance check for this deployment's small, manually-funded
 * operational Solana wallets — the Solana top-up funding wallet
 * (`SolanaTopupService`/`SOLANA_TOPUP_FUNDING_SECRET_KEY`) and the gas relayer's fee-payer
 * wallet (`GasRelayerService`/`SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY`), both previously
 * unmonitored — a real, named gap `docs/GAS_RELAYER_PLAN.md` called out explicitly. Neither
 * wallet auto-refills; each is topped up by hand, the same operational model
 * `docs/GAS_RELAYER_PLAN.md` already documents for the relayer specifically. Without this,
 * the first sign either wallet ran dry would be user-facing failures (a new wallet's
 * top-up silently not landing; every sponsored quote/submit throwing) with no advance
 * warning.
 *
 * Deliberately parameterized by a list of `MonitoredWallet` rather than two hardcoded
 * checks, so a future third operational wallet is one more list entry, not a second
 * near-identical function. Takes only a `Connection` and public keys — this process never
 * holds either wallet's secret key (see `SOLANA_TOPUP_FUNDING_PUBLIC_KEY`'s own doc comment
 * in config/env.ts), since a balance read needs no signing capability at all.
 *
 * One bad wallet (an RPC hiccup, a malformed public key) never aborts the rest of the
 * batch — same "one failure doesn't block the others" discipline `SolanaSweepService`
 * already applies per-row.
 */
export async function checkTreasuryBalances(connection: Connection, wallets: readonly MonitoredWallet[], logger: Logger): Promise<TreasuryBalanceCheckResult[]> {
  const results: TreasuryBalanceCheckResult[] = [];
  for (const wallet of wallets) {
    try {
      const lamports = await connection.getBalance(new PublicKey(wallet.publicKey), 'confirmed');
      const belowThreshold = lamports < wallet.warnThresholdLamports;
      if (belowThreshold) {
        logger.warn(
          { label: wallet.label, publicKey: wallet.publicKey, lamports, warnThresholdLamports: wallet.warnThresholdLamports },
          'Treasury wallet balance is below its warning threshold — top up soon',
        );
      } else {
        logger.info({ label: wallet.label, lamports }, 'Treasury balance check');
      }
      results.push({ label: wallet.label, lamports, belowThreshold });
    } catch (error) {
      logger.error({ err: error, label: wallet.label, publicKey: wallet.publicKey }, 'Treasury balance check failed — will retry next tick');
      results.push({ label: wallet.label, lamports: null, belowThreshold: false });
    }
  }
  return results;
}
