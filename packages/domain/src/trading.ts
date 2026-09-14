import { z } from 'zod';
import { normalizeEvmAddress } from './wallet';

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
});
export type TradeTransactionDto = z.infer<typeof TradeTransactionSchema>;

/** Solana's native USDC mint — see docs/TRADING.md#solana. The fixed anchor for the 1-tap
 *  buy flow on both the API (SolanaQuoteService) and the frontend (UsdPresetAmountInput):
 *  "BUY" always spends this to acquire the target mint, "SELL" always produces this.
 *  Verified against Circle's own published mint address — single-sourced here rather than
 *  duplicated per-consumer, same reasoning as the EVM side's per-chain USDC addresses
 *  living in one place (getConfiguredChains) rather than copy-pasted. */
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
 *  `GET /solana/transactions/:id` response shape. No separate fee-transfer tracking (see
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
