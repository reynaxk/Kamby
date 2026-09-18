import { z } from 'zod';
import { NOTIFICATION_DEFAULTS } from '@kamby/domain';

/**
 * V1 runs on exactly one chain (see /docs/CHAIN_ADAPTERS.md) — these four CHAIN_* variables
 * describe it. Adding a second chain later means adding a second set of variables and a
 * second ChainDataProvider instance, not changing this shape.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (redis connection string)'),

  CHAIN_IDENTIFIER: z.string().min(1, 'CHAIN_IDENTIFIER is required, e.g. "eip155:8453"'),
  CHAIN_NAME: z.string().min(1, 'CHAIN_NAME is required, e.g. "Base"'),
  CHAIN_NATIVE_SYMBOL: z.string().min(1, 'CHAIN_NATIVE_SYMBOL is required, e.g. "ETH"'),
  /** Resolved RPC endpoint for the configured chain — never hardcoded, never logged. */
  CHAIN_RPC_URL: z.string().url('CHAIN_RPC_URL must be a valid URL'),
  /** Optional second RPC endpoint — see docs/TRADING.md#rpc-failover. A real, previously-
   *  hit failure mode: QuickNode's Base RPC has already exhausted its daily quota once in
   *  production, breaking market ingestion with no fallback configured. Genuinely optional
   *  — running without one is valid, just unprotected against exactly that class of
   *  outage. */
  CHAIN_RPC_URL_FALLBACK: z.string().url('CHAIN_RPC_URL_FALLBACK must be a valid URL').optional(),

  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** How often the market ingestion tick (price/liquidity refresh + swap backfill) runs. */
  MARKET_INGESTION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** How often the Phase 3 trade-status sweep checks PENDING transactions for a real
   *  on-chain receipt — see docs/TRADING.md#transaction-lifecycle. Independent of
   *  apps/api's on-demand refresh; this is the backstop for trades nobody is watching. */
  TRADE_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

  /**
   * Solana's counterpart to the sweep above — see docs/TRADING.md#transaction-lifecycle
   * and apps/api/src/solana/solana-transaction.service.ts's own doc comment on why this
   * sweep deliberately doesn't re-verify on-chain instructions against the persisted quote
   * the way the EVM sweep does. Off by default, same convention apps/api's SOLANA_ENABLED
   * already uses — a deployment with Solana off shouldn't be forced to populate any of the
   * fields below.
   */
  SOLANA_ENABLED: z.coerce.boolean().default(false),
  SOLANA_RPC_URL: z.string().url('SOLANA_RPC_URL must be a valid URL').optional(),
  /** Optional second endpoint — see docs/TRADING.md#rpc-failover. Genuinely optional even
   *  when SOLANA_ENABLED is true: running without a fallback is valid, just unprotected
   *  against the primary's own outages. */
  SOLANA_RPC_URL_FALLBACK: z.string().url('SOLANA_RPC_URL_FALLBACK must be a valid URL').optional(),
  SOLANA_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

  /**
   * Treasury balance monitoring — see solana/treasury-balance-monitor.ts's own doc comment.
   * Deliberately reads only *public* keys, never the secret keys apps/api holds for these
   * same two wallets (SOLANA_TOPUP_FUNDING_SECRET_KEY, SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY)
   * — a balance check is a read-only RPC call that never needs signing capability, so this
   * process has no business holding either secret. Each wallet is monitored independently:
   * set its public key here to turn monitoring for that wallet on, leave it unset to skip it
   * (a valid, common state before either operational wallet is actually funded/enabled on
   * the api side) — neither requires the other to be configured.
   */
  SOLANA_TREASURY_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  SOLANA_TOPUP_FUNDING_PUBLIC_KEY: z.string().min(1).optional(),
  /** Default: 0.05 SOL — 5x SOLANA_NEW_WALLET_TOPUP_SOL's own 0.01 SOL default (apps/api),
   *  not derived programmatically since the two processes don't share config; if that
   *  per-wallet amount changes, reconsider this default too. */
  SOLANA_TOPUP_WARN_THRESHOLD_LAMPORTS: z.coerce.number().int().positive().default(50_000_000),
  SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY: z.string().min(1).optional(),
  /** Default: 0.1 SOL — headroom above SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING's own
   *  ~0.003 SOL default (apps/api, one sponsored transaction's worst case), enough for
   *  several sponsored trades' worth of runway before this actually runs dry. */
  SOLANA_GAS_RELAYER_WARN_THRESHOLD_LAMPORTS: z.coerce.number().int().positive().default(100_000_000),

  /**
   * EVM gas relayer balance monitoring — the EVM counterpart to the Solana treasury monitor
   * above, see trading/evm-relayer-balance-monitor.ts's own doc comment for why this didn't
   * exist until now. Deliberately scoped to a single public key, not a multi-chain map:
   * this deployment only ever watches its own configured chain (CHAIN_RPC_URL/
   * CHAIN_IDENTIFIER above). Reads only the public key, never the secret apps/api holds for
   * the same wallet.
   */
  EVM_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY: z.string().min(1).optional(),
  /** A placeholder default, not derived from a real per-chain ceiling the way Solana's own
   *  default is: apps/api's EVM_GAS_RELAYER_MAX_WEI_CEILING_<SLUG> is deliberately left
   *  unset pending real 4g adversarial-pass data (see docs/GAS_RELAYER_PLAN.md's EVM
   *  section) — there's no single canonical per-trade ceiling to derive headroom from yet.
   *  0.005 ETH — revisit once that data exists. */
  EVM_GAS_RELAYER_WARN_THRESHOLD_WEI: z.coerce.number().int().positive().default(5_000_000_000_000_000),
  EVM_GAS_RELAYER_BALANCE_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * Pump.fun bonding-curve ingestion (FRESH/NEAR_GRADUATED/JUST_GRADUATED trenches) — see
   * docs/TRADING.md#pump-fun-trenches. Deliberately a *separate* flag from SOLANA_ENABLED
   * above: this is a genuinely different, riskier subsystem (a persistent WebSocket log
   * subscription, not a tick) that reuses SOLANA_RPC_URL's host for its own wss://
   * connection rather than a second configured URL — same derivation
   * apps/web/lib/privy-config.ts already uses for the same reason (most providers, Helius
   * included, serve the websocket subscription API off the same host as https://, just
   * wss:// instead). Off by default; enabling it requires SOLANA_ENABLED to also be true,
   * since there is no meaningful SOLANA_RPC_URL without it.
   */
  PUMPFUN_INGESTION_ENABLED: z.coerce.boolean().default(false),

  /** The one configurable knob behind "whale trade" alerts (see
   *  docs/NOTIFICATIONS.md#whale-trades) — centralized here rather than hardcoded at each
   *  call site, and defaulted from the same @kamby/domain constant apps/api would use if it
   *  ever needed to display this threshold, so the two processes can never disagree. */
  WHALE_TRADE_USD_THRESHOLD: z.coerce.number().positive().default(NOTIFICATION_DEFAULTS.whaleTradeUsdThreshold),

  /**
   * Realized-PnL ledger sweep — see docs/TRADER_INTELLIGENCE.md#realized-pnl and
   * PnlLedgerSweepService's own doc comment. Deliberately cross-chain (scans both
   * `trade_transactions` and `solana_trade_transactions` regardless of this deployment's
   * own `CHAIN_IDENTIFIER`) and deliberately off by default: `apps/workers` runs one
   * replica per EVM chain by design, so this must be enabled on exactly ONE deployment,
   * never on every chain's own worker, or the same backlog gets raced concurrently — the
   * sweep's own Postgres advisory lock is a correctness backstop for that, not a license
   * to enable it everywhere.
   */
  PNL_LEDGER_SWEEP_ENABLED: z.coerce.boolean().default(false),
  PNL_LEDGER_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
}).superRefine((env, ctx) => {
  if (!env.SOLANA_ENABLED) return;
  if (env.SOLANA_RPC_URL === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_RPC_URL'], message: 'SOLANA_RPC_URL is required when SOLANA_ENABLED is true' });
  }
}).superRefine((env, ctx) => {
  if (env.PUMPFUN_INGESTION_ENABLED && !env.SOLANA_ENABLED) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUMPFUN_INGESTION_ENABLED'], message: 'PUMPFUN_INGESTION_ENABLED requires SOLANA_ENABLED to also be true' });
  }
});

export type Env = z.infer<typeof EnvSchema>;
