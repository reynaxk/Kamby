import { z } from 'zod';

/**
 * Realized PnL — pure logic and Zod schemas only (no I/O, matching every other file in
 * this package). See docs/TRADER_INTELLIGENCE.md#realized-pnl for the full methodology
 * writeup this implements: scoped to Kamby-originated trades only
 * (`TradeTransaction`/`SolanaTradeTransaction`), FIFO lot-matching, gross (not
 * fee-adjusted), priced off each leg's own quote (quote-time, not settlement-time). The
 * actual database I/O and per-transaction sweep loop live in
 * `apps/workers/src/pnl/pnl-ledger-sweep.ts` — this file only ever receives data the
 * caller has already fetched and returns data for the caller to persist, the same
 * "pure formulas, no I/O" split `trader-intelligence.ts` already establishes.
 */

/** One of a wallet's open (partially or fully unconsumed) BUY lots, as the FIFO matcher
 *  needs it — a narrowed view of `TokenLot`, not the full Prisma row. `costBasisUsd` is
 *  the *lot's total* cost basis for `quantityOriginalRaw`, not a per-unit price; the
 *  matcher derives a matched portion's proportional share from the ratio of the two raw
 *  quantities. */
export interface OpenLot {
  id: string;
  /** Raw integer units (pre-decimals), as a string — see docs/TRADING.md#financial-precision
   *  for why every token amount in this codebase is a string, never a JS number. */
  quantityOriginalRaw: string;
  quantityRemainingRaw: string;
  costBasisUsd: number;
}

export interface FifoMatch {
  lotId: string;
  quantityMatchedRaw: string;
  /** This match's proportional share of its lot's own cost basis — see OpenLot's own
   *  comment for the ratio this is derived from. */
  costBasisUsd: number;
}

export interface FifoMatchResult {
  matches: FifoMatch[];
  /** The portion of `sellQuantityRaw` that couldn't be matched against any open lot —
   *  e.g. a wallet that held the token before ever trading it through Kamby. Never
   *  matched against a fabricated lot and never counted as free profit — see
   *  docs/TRADER_INTELLIGENCE.md#realized-pnl. `"0"` when the sell was fully matched. */
  unmatchedQuantityRaw: string;
}

/**
 * FIFO-matches a SELL's quantity against a wallet's open lots for the same token.
 * `openLots` must already be ordered oldest-`acquiredAt`-first — this function doesn't
 * sort (sorting is a query concern, not a matching-logic concern). Walks the lots in
 * order, consuming each one's `quantityRemainingRaw` (never `quantityOriginalRaw` — a
 * partially-consumed lot from an earlier sell must not be double-spent) until the sell
 * quantity is exhausted or the lots run out, whichever comes first.
 */
export function matchFifoSell(openLots: readonly OpenLot[], sellQuantityRaw: string): FifoMatchResult {
  let remaining = BigInt(sellQuantityRaw);
  if (remaining < 0n) throw new Error('sellQuantityRaw must not be negative');
  const matches: FifoMatch[] = [];

  for (const lot of openLots) {
    if (remaining <= 0n) break;
    const lotRemaining = BigInt(lot.quantityRemainingRaw);
    if (lotRemaining <= 0n) continue;
    const lotOriginal = BigInt(lot.quantityOriginalRaw);
    const matchedQty = remaining < lotRemaining ? remaining : lotRemaining;
    // A ratio of two same-order-of-magnitude raw integers, not an absolute raw amount —
    // safe as a float the same way TraderStats.volumeUsd/avgTradeSizeUsd already are
    // (see trader-intelligence.ts), unlike calculateFeeAmount's on-chain-money bigint
    // math, which this deliberately isn't (no transaction is built from this number).
    const costBasisUsd = lotOriginal > 0n ? lot.costBasisUsd * (Number(matchedQty) / Number(lotOriginal)) : 0;
    matches.push({ lotId: lot.id, quantityMatchedRaw: matchedQty.toString(), costBasisUsd });
    remaining -= matchedQty;
  }

  return { matches, unmatchedQuantityRaw: remaining.toString() };
}

export interface RealizedPnlMatch extends FifoMatch {
  /** This match's proportional share of the *whole sell's* proceeds — allocated by the
   *  matched quantity's share of `sellQuantityRaw` (the full sell, including any
   *  unmatched portion), not just the matched total, so each matched unit gets its true
   *  fractional share regardless of how much of the sell went unmatched. */
  proceedsUsd: number;
  /** = proceedsUsd - costBasisUsd. Gross — never fee-adjusted (gas, and any platform
   *  fee, are not subtracted here) — see docs/TRADER_INTELLIGENCE.md#realized-pnl for why
   *  that's a disclosed simplification, not an oversight. */
  realizedPnlUsd: number;
}

export interface RealizedPnlResult {
  matches: RealizedPnlMatch[];
  unmatchedQuantityRaw: string;
}

/**
 * `matchFifoSell` plus proceeds allocation and the realized-PnL subtraction — the one
 * call `PnlLedgerSweepService` needs per CONFIRMED sell to build its `RealizedPnlEvent`
 * rows. `sellProceedsUsd` is the *whole* sell's USD proceeds (priced off the sell's own
 * quote); see `RealizedPnlMatch.proceedsUsd`'s own comment for how it's split.
 */
export function computeFifoRealizedPnl(
  openLots: readonly OpenLot[],
  sellQuantityRaw: string,
  sellProceedsUsd: number,
): RealizedPnlResult {
  const { matches, unmatchedQuantityRaw } = matchFifoSell(openLots, sellQuantityRaw);
  const totalSellQty = BigInt(sellQuantityRaw);

  const withProceeds = matches.map((match): RealizedPnlMatch => {
    const proceedsUsd =
      totalSellQty > 0n ? sellProceedsUsd * (Number(BigInt(match.quantityMatchedRaw)) / Number(totalSellQty)) : 0;
    return { ...match, proceedsUsd, realizedPnlUsd: proceedsUsd - match.costBasisUsd };
  });

  return { matches: withProceeds, unmatchedQuantityRaw };
}

// ---------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------

export const PnlWindowSchema = z.enum(['24h', '7d', '30d']);
export type PnlWindow = z.infer<typeof PnlWindowSchema>;

/** One rolling-window realized-PnL aggregate — `SUM(realized_pnl_usd)`/`SUM(cost_basis_usd)`
 *  over `realized_pnl_events` for one user, filtered to `confirmedAt >= now() - window`. See
 *  docs/TRADER_INTELLIGENCE.md#realized-pnl. */
export const PnlWindowStatsSchema = z.object({
  window: PnlWindowSchema,
  /** Null — never a fabricated 0 — when zero volume was matched in this window at all,
   *  the same null-vs-zero discipline TraderStats.avgTradeSizeUsd/buyRatio already
   *  establish (see trader-intelligence.ts): a PnL of a trade that never happened is
   *  undefined, not a real zero. */
  realizedPnlUsd: z.number().nullable(),
  /** = realizedPnlUsd / costBasisUsd * 100 for this window's matched lots. Null under the
   *  exact same condition as realizedPnlUsd — an average/return over zero matched cost
   *  basis is undefined, not 0%. */
  realizedPnlPct: z.number().nullable(),
  /** SUM of matched cost basis + proceeds for this window — the trade volume this PnL
   *  figure is actually derived from, shown alongside it so the number is never read
   *  without its own scale. */
  volumeUsd: z.number().min(0),
});
export type PnlWindowStats = z.infer<typeof PnlWindowStatsSchema>;

/** A trader profile's realized-PnL block — see docs/TRADER_INTELLIGENCE.md#realized-pnl.
 *  `null` (the whole object, not just its fields) when the wallet has no linked `User` —
 *  "no Kamby account" is real and common (most wallets are indexer-observed only, see
 *  Wallet's own doc comment), distinct from "has an account but zero realized PnL yet"
 *  (a real object with null window stats). */
export const TraderRealizedPnlSchema = z.object({
  '24h': PnlWindowStatsSchema,
  '7d': PnlWindowStatsSchema,
  '30d': PnlWindowStatsSchema,
});
export type TraderRealizedPnl = z.infer<typeof TraderRealizedPnlSchema>;

/** One leaderboard row — see docs/TRADER_INTELLIGENCE.md#realized-pnl. `username`/`avatarUrl`
 *  are the real, user-set identity on `User` (never a generated fallback — see
 *  `TraderIdentity.tsx`'s own honesty rule for how the frontend renders a wallet with
 *  neither set). `walletAddress` is whichever of the user's several verified wallets was
 *  most recently used (`Wallet.lastUsedAt`), reusing `WalletService#listWallets`'s
 *  existing ordering rather than inventing a new "primary wallet" concept. */
export const LeaderboardEntrySchema = z.object({
  userId: z.string().uuid(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  walletAddress: z.string(),
  realizedPnlUsd: z.number(),
  realizedPnlPct: z.number().nullable(),
  volumeUsd: z.number().min(0),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
  window: PnlWindowSchema,
  entries: z.array(LeaderboardEntrySchema),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;

/** One currently-open position — a user's remaining (unconsumed) TokenLot balance for one
 *  token, decimals-adjusted, with unrealized PnL against the token's current market price.
 *  EVM-only for now (see TokenThesisSchema's own scope note; positions follow the exact
 *  same reasoning — the market price/liquidity this needs to value a position only exists
 *  for EVM's TokenMarket today). `costBasisUsd` here is the *remaining* lots' cost basis
 *  (proportional to what's left after any partial sells), not the original full-lot cost —
 *  the same "remaining, not original" quantity every figure on this type reflects.
 *  Closed-out positions (fully sold) aren't included here at all — see /leaderboard and
 *  /trades for realized PnL and full trade history instead, which already cover that. */
export const TokenPositionSchema = z.object({
  tokenAddress: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  logoUrl: z.string().nullable(),
  quantity: z.number().min(0),
  costBasisUsd: z.number().min(0),
  /** Null when the token's current price can't be honestly resolved (no market with a
   *  priced pool yet) — never a stale or fabricated value. */
  currentPriceUsd: z.number().nullable(),
  currentValueUsd: z.number().nullable(),
  unrealizedPnlUsd: z.number().nullable(),
  unrealizedPnlPct: z.number().nullable(),
});
export type TokenPosition = z.infer<typeof TokenPositionSchema>;

/** The exact millisecond-window lookback for each PnlWindow value — the single source of
 *  truth every `confirmedAt >= now() - X` query (leaderboard, trader profile) reads
 *  from, so "24h" can never quietly mean two different things in two different queries. */
export const PNL_WINDOW_MS: Record<PnlWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Turns a raw `SUM(realized_pnl_usd)`/`SUM(cost_basis_usd)`/`SUM(proceeds_usd)` SQL
 *  aggregate into a `PnlWindowStats` — the one place the null-vs-zero rule (no matched
 *  volume at all) is applied, so every caller (leaderboard, trader profile) gets it for
 *  free rather than re-implementing the check. `matchedCount` is the row count backing
 *  the sums — `0` is what actually means "no volume," not the sums themselves (which SQL
 *  `SUM()` already returns as `null` over zero rows, but a caller reading from a JS
 *  aggregation library may have normalized that to `0` before this ever sees it).
 */
export function toPnlWindowStats(
  window: PnlWindow,
  aggregate: { realizedPnlUsd: number; costBasisUsd: number; proceedsUsd: number; matchedCount: number },
): PnlWindowStats {
  if (aggregate.matchedCount <= 0) {
    return { window, realizedPnlUsd: null, realizedPnlPct: null, volumeUsd: 0 };
  }
  return {
    window,
    realizedPnlUsd: aggregate.realizedPnlUsd,
    realizedPnlPct: aggregate.costBasisUsd > 0 ? (aggregate.realizedPnlUsd / aggregate.costBasisUsd) * 100 : null,
    volumeUsd: aggregate.costBasisUsd + aggregate.proceedsUsd,
  };
}

/**
 * One day's own realized PnL, plus the running total through end of that day — the real
 * material for a "portfolio value over time" chart. Deliberately named and scoped as
 * *realized* PnL over time, not a full mark-to-market equity curve: reconstructing what an
 * open position was worth on some past day would need a historical price snapshot per
 * token per day, which this codebase doesn't store (TokenMarket only ever holds the
 * *current* price) — anything claiming to chart that would be extrapolating, not reporting.
 * This charts what's honestly knowable: money actually realized, day by day.
 *
 * `realizedPnlUsd` here is a real `0` (never `null`) for a day with no matched sells — the
 * question this field answers ("what did this specific day contribute") has a true zero
 * answer, unlike PnlWindowStats' null-vs-zero split (which asks "did ANY trading happen in
 * this whole window at all" — a genuinely different question). Every day in the requested
 * range appears, including zero-activity days, so a chart never has to guess whether a gap
 * means "no data" or "exactly broke even."
 */
export const PnlHistoryPointSchema = z.object({
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: z.string(),
  realizedPnlUsd: z.number(),
  cumulativeRealizedPnlUsd: z.number(),
});
export type PnlHistoryPoint = z.infer<typeof PnlHistoryPointSchema>;

export const PnlHistorySchema = z.object({
  days: z.number().int().positive(),
  points: z.array(PnlHistoryPointSchema),
});
export type PnlHistory = z.infer<typeof PnlHistorySchema>;
