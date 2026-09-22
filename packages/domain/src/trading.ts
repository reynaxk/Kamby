import { z } from 'zod';
import { normalizeEvmAddress } from './wallet';
import { RelayedSwapTypedDataWireSchema } from './evm-relayer';

/**
 * Phase 3 trading domain: quotes, fees, slippage, and the transaction lifecycle. See
 * docs/TRADING.md. Every token amount here is a raw (pre-decimals) integer — a `bigint` in
 * code, a `string` at rest and over the wire — never a JS `number`. `number` only ever
 * appears for USD/percentage display values, which are inherently approximate and never
 * fed back into a calculation that must be exact.
 */

export const TradeSideSchema = z.enum(['BUY', 'SELL']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

export const TradeStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED']);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

/**
 * Deliberately configuration, not scattered literals — see docs/TRADING.md#fees. Every one
 * of these can be overridden by the API's env config; these are only the shipped defaults.
 */
export const TRADING_DEFAULTS = {
  /** 0.50% — see docs/TRADING.md#fees. */
  platformFeeBps: 50,
  /** No fixed-dollar minimum fee: on a small trade a flat minimum is an arbitrarily large
   *  effective rate (see docs/TRADING.md#fees) — disabled unless a future minimum is
   *  explicitly configured. */
  platformFeeMinUsd: null as number | null,
  defaultSlippageBps: 50,
  minSlippageBps: 1,
  /** 20% — above this a slippage tolerance stops being a safety margin and starts being an
   *  invitation to sandwich the trade; reject it rather than trust it. */
  maxSlippageBps: 2000,
  quoteTtlSeconds: 30,
  /** How long a submitted transaction can sit with no receipt before Phase 3 gives up
   *  watching it and marks it EXPIRED (likely dropped/replaced in the mempool) rather than
   *  polling forever — see docs/TRADING.md#transaction-lifecycle. Base's block time is
   *  ~2s, so 30 minutes is generous, not tight. */
  pendingTransactionTimeoutMinutes: 30,
  /** A successful receipt alone was previously treated as final the instant it was seen —
   *  a real reorg gap on an OP-stack L2 like Base, where a just-mined block can still be
   *  dropped/reordered before it's sufficiently settled. CONFIRMED now additionally
   *  requires this many blocks mined on top of the transaction's own block — see
   *  docs/TRADING.md#transaction-lifecycle. 2 is a deliberate small number: enough to rule
   *  out the single-block reorgs that actually happen in practice, without adding
   *  meaningful latency on a ~2s-block chain (worst case ~4-6s beyond the receipt itself).
   */
  minConfirmations: 2,
  /** Price impact at/above this warrants a visible warning but not blocking the trade. */
  highPriceImpactBps: 500,
  /** Price impact at/above this requires the explicit acknowledgement described in
   *  docs/TRADING.md#price-impact before the UI allows signing. */
  extremePriceImpactBps: 1500,
} as const;

/** The exact, honest wording for every trade surface — see docs/TRADING.md#token-safety.
 *  Never "Safe" or "Verified": Kamby's checks are real but bounded (liquidity, staleness,
 *  that a route exists), not a security audit. */
export const SAFETY_DISCLAIMER = 'No known issues detected by available checks.';

export type PriceImpactLevel = 'normal' | 'high' | 'extreme';

export function classifyPriceImpactBps(bps: number | null): PriceImpactLevel | null {
  if (bps === null) return null;
  if (bps >= TRADING_DEFAULTS.extremePriceImpactBps) return 'extreme';
  if (bps >= TRADING_DEFAULTS.highPriceImpactBps) return 'high';
  return 'normal';
}

/** Integer basis points only, within the configured safe range — see
 *  docs/TRADING.md#slippage. Rejects, rather than clamps, an out-of-range value: silently
 *  substituting a "safe" number for a dangerous client input would hide the mistake instead
 *  of surfacing it. */
export function isValidSlippageBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= TRADING_DEFAULTS.minSlippageBps && bps <= TRADING_DEFAULTS.maxSlippageBps;
}

/**
 * The platform's tiered fee — locked in for EVM 2026-09-16, superseding the flat
 * `TRADING_DEFAULTS.platformFeeBps`/`PLATFORM_FEE_BPS` for `QuoteService` (see that file's
 * own doc comment — the env var is left defined but no longer read for the fee rate
 * itself). A percentage-of-trade-size schedule: smaller trades pay a higher rate to cover
 * fixed per-trade overhead (routing, safety checks, gas), scaling down as size grows.
 * `minUsd` is inclusive; entries must stay ordered ascending by `minUsd` for
 * `resolveTierFeeBps` below to resolve correctly.
 *
 * As of the fee-tier reconciliation, this is the **single** source of truth for both
 * chains — `SolanaQuoteService#resolvePlatformFeeBps` (`apps/api/src/solana/`) resolves
 * through this exact table too, replacing Solana's own former two-tier schedule
 * (`jupiter-fee-schedule.ts`, deleted). The two chains' fee rates are no longer allowed to
 * drift apart silently.
 */
export const PLATFORM_FEE_TIERS: readonly { minUsd: number; feeBps: number }[] = [
  { minUsd: 0, feeBps: 200 }, // up to $99.99…: 2.00%
  { minUsd: 100, feeBps: 100 }, // $100–$499.99…: 1.00%
  { minUsd: 500, feeBps: 75 }, // $500 and up: 0.75%
];

/** The tier `resolveTierFeeBps` falls back to when a trade's real USD size genuinely can't
 *  be confirmed before a %-based fee must be decided — on EVM, a non-USDC-quoted BUY's
 *  size needs a fee-free pre-quote that can, rarely, come back empty (see `QuoteService`'s
 *  own doc comment); on Solana, a SELL's size-discovery pre-quote can likewise fail (see
 *  `SolanaQuoteService#resolvePlatformFeeBps`). Deliberately the most expensive tier, never
 *  a cheaper one — never silently apply an unconfirmed lower rate. */
export const PLATFORM_FEE_FALLBACK_BPS = PLATFORM_FEE_TIERS[0]!.feeBps;

/** Resolves a trade's USD size to its tier's fee, in basis points — walks `tiers` (ordered
 *  ascending by `minUsd`) and returns the highest tier whose `minUsd` the amount meets or
 *  exceeds. `tiers` is a parameter (defaulting to `PLATFORM_FEE_TIERS`) purely so tests can
 *  exercise the resolution logic against a small fixture schedule without depending on the
 *  real numbers above. */
export function resolveTierFeeBps(
  usdAmount: number,
  tiers: readonly { minUsd: number; feeBps: number }[] = PLATFORM_FEE_TIERS,
): number {
  if (!Number.isFinite(usdAmount) || usdAmount < 0) {
    throw new Error('usdAmount must be a non-negative finite number');
  }
  if (tiers.length === 0) throw new Error('tiers must not be empty');
  let bps = tiers[0]!.feeBps;
  for (const tier of tiers) {
    if (usdAmount >= tier.minUsd) bps = tier.feeBps;
  }
  return bps;
}

/**
 * Exact integer basis-points math on raw token units — never floating point (see
 * docs/TRADING.md#financial-precision). `feeBps` is a parameter, not a hardcoded import, so
 * every caller must state which fee it's applying rather than assuming a global default.
 */
export function calculateFeeAmount(amountRaw: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0) throw new Error('feeBps must be a non-negative integer');
  if (amountRaw < 0n) throw new Error('amountRaw must not be negative');
  return (amountRaw * BigInt(feeBps)) / 10_000n;
}

/** The floor output amount a transaction must enforce on-chain to honor a given slippage
 *  tolerance — what "slippage protection" concretely means in this codebase. */
export function calculateMinOutputAmount(expectedOutputRaw: bigint, slippageBps: number): bigint {
  if (!isValidSlippageBps(slippageBps)) throw new Error('slippageBps out of the allowed range');
  if (expectedOutputRaw < 0n) throw new Error('expectedOutputRaw must not be negative');
  return (expectedOutputRaw * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function isQuoteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export const UnsignedTransactionSchema = z.object({
  to: z.string(),
  data: z.string(),
  /** Raw wei, as a string — see the module comment above. */
  value: z.string(),
  gas: z.string().nullable(),
  maxFeePerGas: z.string().nullable(),
  maxPriorityFeePerGas: z.string().nullable(),
});
export type UnsignedTransaction = z.infer<typeof UnsignedTransactionSchema>;

/** Defensively parses a persisted `TradeQuote.unsignedTx` JSON blob back into a typed
 *  `UnsignedTransaction` — `null` for anything malformed rather than trusting it blindly.
 *  Should only ever fail for a corrupted row (this codebase is the only writer), but a
 *  transaction-integrity check (see `transactionMatchesQuote` below) must never proceed on
 *  an assumption it hasn't actually verified. See docs/TRADING.md#transaction-integrity. */
export function parseUnsignedTx(json: unknown): UnsignedTransaction | null {
  const result = UnsignedTransactionSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** The real, on-chain fields of a transaction — as read from the chain itself
 *  (`eth_getTransactionByHash` / a receipt), never from anything a client claims. */
export interface OnChainTransactionDetails {
  from: string;
  /** `null` for a contract-creation transaction — never expected for a swap, but a real
   *  possible value, so it's typed honestly rather than coerced. */
  to: string | null;
  value: bigint;
  /** Calldata, as a `0x`-prefixed hex string. */
  data: string;
}

export interface ExpectedTransaction {
  walletAddress: string;
  unsignedTx: UnsignedTransaction;
}

/**
 * The authoritative gate between "a transaction hash has a successful receipt" and "this
 * quote is CONFIRMED" — see docs/TRADING.md#transaction-integrity. A receipt's success
 * alone proves nothing about *which* trade happened; it only proves *some* transaction with
 * this hash succeeded. Only a transaction whose real on-chain sender, destination, value,
 * and calldata all match exactly what was quoted is the trade Kamby actually reviewed with
 * the user — never an unrelated, if genuinely successful, transaction hash.
 */
export function transactionMatchesQuote(actual: OnChainTransactionDetails, expected: ExpectedTransaction): boolean {
  const expectedFrom = normalizeEvmAddress(expected.walletAddress);
  const expectedTo = normalizeEvmAddress(expected.unsignedTx.to);
  const expectedValue = BigInt(expected.unsignedTx.value);
  const expectedData = expected.unsignedTx.data.toLowerCase();

  const actualFrom = normalizeEvmAddress(actual.from);
  const actualTo = actual.to === null ? null : normalizeEvmAddress(actual.to);
  const actualData = actual.data.toLowerCase();

  return actualFrom === expectedFrom && actualTo === expectedTo && actual.value === expectedValue && actualData === expectedData;
}

const TradeTokenSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable(),
  decimals: z.number().int(),
});

/**
 * A priced, signable offer — the API's `GET /trade/quote` response shape. `*Formatted`
 * fields are decimal strings for display only (via `viem`'s `formatUnits`), derived from
 * the raw fields and never fed back into a calculation — see
 * docs/TRADING.md#financial-precision.
 */
export const TradeQuoteSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  side: TradeSideSchema,
  token: TradeTokenSchema,
  quoteToken: TradeTokenSchema,
  inputAmount: z.string(),
  expectedOutputAmount: z.string(),
  minOutputAmount: z.string(),
  inputAmountFormatted: z.string(),
  expectedOutputAmountFormatted: z.string(),
  minOutputAmountFormatted: z.string(),
  priceUsd: z.number().nullable(),
  priceImpactBps: z.number().int().nullable(),
  priceImpactLevel: z.enum(['normal', 'high', 'extreme']).nullable(),
  slippageBps: z.number().int(),
  platformFeeBps: z.number().int(),
  platformFeeAmount: z.string(),
  platformFeeAmountFormatted: z.string(),
  provider: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  unsignedTx: UnsignedTransactionSchema,
  /** A second, separate transaction that moves the platform fee as a plain USDC transfer —
   *  present only when this trade's cash side (input for BUY, quoted output for SELL) is
   *  actually USDC, `null` otherwise. See docs/TRADING.md#guaranteed-usdc-fees: unlike
   *  `unsignedTx`'s fee accounting (an aggregator-embedded cut that can land in whatever
   *  token the swap produces), signing and broadcasting this guarantees the fee is
   *  collected in USDC, never a mix. Built from the *quoted* amount, not a post-swap actual
   *  — see the function comment on `calculateFeeAmount` callers in quote.service.ts for why
   *  that's an intentional, economically negligible tradeoff against a much simpler design. */
  feeUnsignedTx: UnsignedTransactionSchema.nullable(),
  /** Whether the EVM gas relayer *could* sponsor this trade if asked — computed and
   *  present on every quote, independent of whether sponsorship was actually requested.
   *  `false` whenever the relayer isn't configured for this chain, or (when a rollout
   *  allowlist is set) this wallet isn't on it. See
   *  `EvmGasRelayerQuoteService#attachSponsorshipIfEligible`'s own doc comment for why
   *  this is split from `consentTypedData` below — it's what lets the frontend decide
   *  whether to even show a gasless toggle at all. */
  sponsorshipAvailable: z.boolean(),
  /** Present only when this quote was both requested-as-sponsored
   *  (`POST /trade/quote`'s `sponsorshipRequested`) AND actually eligible (the EVM gas
   *  relayer is configured for this chain, and — when a rollout allowlist is set — this
   *  wallet is on it) — absent otherwise, indistinguishably from "sponsorship wasn't
   *  requested at all." See docs/GAS_RELAYER_PLAN.md's EVM section. The exact EIP-712
   *  typed-data object the wallet must sign (Privy's `useSignTypedData`) to prove
   *  real-time consent to this specific quote before `POST /trade/relay`. */
  consentTypedData: RelayedSwapTypedDataWireSchema.optional(),
  /** See SAFETY_DISCLAIMER above — a fixed, honest disclosure string, never a "Safe" badge. */
  safetyNote: z.string(),
  requiresApproval: z.boolean(),
  approvalSpender: z.string().nullable(),
});
export type TradeQuoteDto = z.infer<typeof TradeQuoteSchema>;

/** The `GET /trade/history` / `GET /trade/transactions/:id` response shape. Status comes
 *  from an on-chain receipt check, never a client claim — see
 *  docs/TRADING.md#transaction-lifecycle. */
export const TradeTransactionSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  txHash: z.string(),
  side: TradeSideSchema,
  token: TradeTokenSchema,
  quoteToken: TradeTokenSchema,
  inputAmount: z.string(),
  expectedOutputAmount: z.string(),
  inputAmountFormatted: z.string(),
  expectedOutputAmountFormatted: z.string(),
  platformFeeAmount: z.string(),
  platformFeeAmountFormatted: z.string(),
  status: TradeStatusSchema,
  failureReason: z.string().nullable(),
  submittedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  /** The separate USDC fee-transfer transaction's own hash and status — see
   *  docs/TRADING.md#guaranteed-usdc-fees. `null` for every field when this trade's fee
   *  wasn't eligible for the guaranteed-USDC flow (feeUnsignedTx was null on the quote), or
   *  when it was eligible but the wallet hasn't submitted it yet — the primary trade's own
   *  `status` above is never gated on this: a swap that confirmed is a confirmed trade
   *  regardless of whether its fee transfer has landed yet. */
  feeTxHash: z.string().nullable(),
  feeStatus: TradeStatusSchema.nullable(),
  feeFailureReason: z.string().nullable(),
  feeConfirmedAt: z.string().datetime().nullable(),
  /** True only for a transaction the EVM gas relayer itself broadcast (the relayer paid
   *  the network fee) — false for every self-paid trade, which is still the entire
   *  launch-scope flow. Mirrors SolanaTradeTransactionDto's own field exactly — see
   *  docs/GAS_RELAYER_PLAN.md's EVM section. */
  sponsoredByRelayer: z.boolean(),
  /** The relayer's own address at the time this transaction was sponsored — null whenever
   *  sponsoredByRelayer is false. */
  relayerFeePayer: z.string().nullable(),
});
export type TradeTransactionDto = z.infer<typeof TradeTransactionSchema>;

/** Solana's native USDC mint — see docs/TRADING.md#solana. The fixed anchor for the 1-tap
 *  buy flow on both the API (SolanaQuoteService) and the frontend (UsdPresetAmountInput):
 *  "BUY" always spends this to acquire the target mint, "SELL" always produces this.
 *  Verified against Circle's own published mint address — single-sourced here rather than
 *  duplicated per-consumer, same reasoning as the EVM side's per-chain USDC addresses
 *  living in one place (getConfiguredChains) rather than copy-pasted. */
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Wrapped native SOL's own mint address — the standard representation of "native SOL" as
 *  an SPL token wherever a mint address is required (a Jupiter route leg, a Pump.fun
 *  bonding curve's default quote asset). A well-known Solana constant, not Kamby-specific,
 *  single-sourced here for the same reason SOLANA_USDC_MINT is. */
export const SOLANA_NATIVE_MINT = 'So11111111111111111111111111111111111111112';

/** GET /market/chains's response shape — see MarketController. Each EVM chain's USDC
 *  contract address, read straight from apps/api's own `getConfiguredChains()` (the exact
 *  same addresses QuoteService/TransactionService/the router services already trade
 *  against), never a client-side-hardcoded constant — see SOLANA_USDC_MINT's own doc
 *  comment on why per-chain EVM USDC addresses live in one place rather than being
 *  copy-pasted into a second, independently-sourced location that could quietly drift from
 *  the addresses this deployment actually trusts. */
export const EvmChainConfigSchema = z.object({
  slug: z.string(),
  chainId: z.number().int().positive(),
  usdcAddress: z.string(),
});
export type EvmChainConfig = z.infer<typeof EvmChainConfigSchema>;

/** Pump.fun's documented bonding-curve graduation threshold — confirmed 2026-09-14 against
 *  multiple independent sources (e.g. https://www.soltokencreator.io/blog/pump-fun-graduation-explained),
 *  ~85 SOL raised. Used only to compute an informational "how close to graduating" progress
 *  percentage (see PumpFunTokenSummarySchema's own doc comment) — never to independently
 *  decide graduation itself; the program's own `complete` flag/CompleteEvent is the sole
 *  source of truth for that. Shared between apps/api (trenches queries) and apps/workers
 *  (ingestion) so the two can never disagree on the number. */
export const PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS = 85_000_000_000n; // 85 SOL, in lamports

/**
 * Solana's counterpart to TradeQuoteSchema — the API's `POST /solana/quote` response
 * shape. Deliberately a separate, simpler schema rather than a shared/parameterized one:
 * Solana trading uses mints instead of EVM token addresses, has no chainId (one deployment
 * runs at most one Solana cluster) and no `feeUnsignedTx` (Jupiter's `platformFeeBps`/
 * `feeAccount` deduct the platform fee atomically inside the swap itself — see
 * docs/TRADING.md#solana), and — for the non-custodial launch scope — no
 * `requiresApproval`/`approvalSpender` (there is no ERC-20-style allowance concept on
 * Solana). `unsignedTxBase64` is Jupiter's own base64-serialized `VersionedTransaction`,
 * never signed by this backend — see docs/WALLET_SECURITY.md.
 */
export const SolanaTradeQuoteSchema = z.object({
  id: z.string().uuid(),
  side: TradeSideSchema,
  inputMint: z.string(),
  outputMint: z.string(),
  inputAmountRaw: z.string(),
  outputAmountRaw: z.string(),
  minOutputAmountRaw: z.string(),
  priceImpactBps: z.number().int().nullable(),
  platformFeeBps: z.number().int(),
  platformFeeAmountRaw: z.string().nullable(),
  unsignedTxBase64: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type SolanaTradeQuoteDto = z.infer<typeof SolanaTradeQuoteSchema>;

/** Solana's counterpart to TradeTransactionSchema — the API's `GET /solana/history` /
 *  `GET /solana/transactions/:id` response shape, also returned directly by both
 *  `POST /solana/transactions` and (as of the gas-relayer completion work)
 *  `POST /solana/transactions/sponsored`. No separate fee-transfer tracking (see
 *  SolanaTradeQuoteSchema's own comment on why) — `status` alone is the whole picture. */
export const SolanaTradeTransactionSchema = z.object({
  id: z.string().uuid(),
  signature: z.string(),
  side: TradeSideSchema,
  inputMint: z.string(),
  outputMint: z.string(),
  inputAmount: z.string(),
  expectedOutputAmount: z.string(),
  platformFeeAmount: z.string(),
  status: TradeStatusSchema,
  failureReason: z.string().nullable(),
  submittedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  /** True only for a transaction the gas relayer itself broadcast — see
   *  docs/GAS_RELAYER_PLAN.md. False for every self-paid trade, still the entire
   *  launch-scope flow as of this field's addition. */
  sponsoredByRelayer: z.boolean(),
});
export type SolanaTradeTransactionDto = z.infer<typeof SolanaTradeTransactionSchema>;

/**
 * Solana's counterpart to social.ts's `ACTIVITY_REALTIME_CHANNEL` — same "bare ping, never
 * the activity itself" contract (see that constant's own doc comment): a client that misses
 * one just catches up on its next fetch/reconnect. Deliberately a separate channel from the
 * EVM one, not a shared one with a chain discriminator: publishing a Solana confirmation
 * happens directly in `SolanaTransactionService` (apps/api), not from a separate ingestion
 * worker the way EVM swaps are — keeping the channel names untangled makes it obvious which
 * side of the codebase owns which publish, at a glance, without reading the publisher.
 */
export const SOLANA_ACTIVITY_REALTIME_CHANNEL = 'kamby:solana-activity:new';

/**
 * One Solana activity feed item — a read-time projection of a confirmed `SolanaTradeTransaction`
 * (see that model's comment in schema.prisma), the same relationship `SocialActivity` has to
 * an indexed EVM `Swap`. Deliberately simpler than `SocialActivity`: Solana trading launched
 * with no per-token metadata table (see SolanaQuoteResult's own doc comment on why the non-
 * USDC leg is shown in raw units), so `tokenMint` is a bare mint address here, not a resolved
 * symbol/name/logo object — never fabricated past what's actually known.
 */
export const SolanaSocialActivitySchema = z.object({
  id: z.string().uuid(),
  walletAddress: z.string(),
  side: TradeSideSchema,
  tokenMint: z.string(),
  /** The USDC-denominated side of the trade — the input amount for BUY (exact, not subject
   *  to slippage) or the expected output amount for SELL (Jupiter's target, not a post-fill
   *  guarantee — see SolanaTradeTransactionSchema's own `expectedOutputAmount` comment). */
  amountUsd: z.number(),
  signature: z.string(),
  confirmedAt: z.string().datetime(),
});
export type SolanaSocialActivity = z.infer<typeof SolanaSocialActivitySchema>;
