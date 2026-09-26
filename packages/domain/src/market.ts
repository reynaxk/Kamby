import { z } from 'zod';

/**
 * The chart/aggregation timeframes the history endpoint accepts. Each maps to a
 * `time_bucket` width applied to the raw 5-minute candles at query time — see
 * docs/MARKET_DATA.md for why buckets are aggregated on read rather than pre-materialized
 * per timeframe.
 */
export const TIMEFRAMES = ['1H', '4H', '1D', '1W', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const DiscoverSortSchema = z.enum(['score', 'volume', 'liquidity', 'priceChange']);
export type DiscoverSort = z.infer<typeof DiscoverSortSchema>;

/**
 * A token market as the API serves it — Token + TokenMarket joined, with Decimal/BigInt
 * fields normalized to plain numbers/strings for JSON. Nullable fields are nullable for a
 * reason (see field comments on TokenMarket in schema.prisma) — the web app must render an
 * honest empty/stale state for them, never a fabricated placeholder.
 */
export const MarketSummarySchema = z.object({
  chainIdentifier: z.string(),
  tokenAddress: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().int().nullable(),
  logoUrl: z.string().nullable(),
  quoteSymbol: z.string().nullable(),
  /** The quote token's own contract address/decimals — see docs/TRADING.md#quote-system.
   *  Added in Phase 3 so the web client can request a trade quote without a second
   *  round-trip; always present since every TokenMarket has a real quote token row. */
  quoteAddress: z.string(),
  quoteDecimals: z.number().int().nullable(),
  dex: z.string().nullable(),
  feeTier: z.number().int().nullable(),
  priceUsd: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  volume24hUsd: z.number().nullable(),
  priceChange24hPct: z.number().nullable(),
  marketCapUsd: z.number().nullable(),
  lastPriceUpdateAt: z.string().datetime().nullable(),
  /** True when lastPriceUpdateAt is older than the staleness window — see docs/MARKET_DATA.md. */
  isStale: z.boolean(),
  /** Present only on /market/discover — the transparent ranking score, see docs/MARKET_DATA.md. */
  discoveryScore: z.number().nullable().optional(),
  /** Present only on /market/discover — a compact ~24h price trend for the row's sparkline
   *  (`Sparkline.tsx`), sampled down from the real `candles` table, oldest first. Absent
   *  (never an empty array or a fabricated flat line) when the market doesn't have enough
   *  real candle history yet — see Sparkline's own "renders nothing" behavior for exactly
   *  that case, e.g. a market still inside its first 24h post-seed. */
  recentCloses: z.array(z.number()).optional(),
});
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

/**
 * A Pump.fun bonding-curve token, as the FRESH/NEAR_GRADUATED/JUST_GRADUATED trenches serve
 * it — see docs/TRADING.md#pump-fun-trenches. Deliberately a separate schema from
 * MarketSummary rather than forced into its Uniswap-shaped fields (`dex`, `feeTier`,
 * `quoteAddress` as a required pool-quote-token concept) — same "concrete separate types
 * over one forced-shared abstraction" precedent as PumpFunToken being its own Prisma model.
 *
 * Reserve fields are raw on-chain u64 values as strings — same "never a native numeric type
 * for a raw amount" discipline as everywhere else in this codebase.
 */
export const PumpFunTokenSummarySchema = z.object({
  mintAddress: z.string(),
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  uri: z.string().nullable(),
  virtualSolReserves: z.string(),
  virtualTokenReserves: z.string(),
  realSolReserves: z.string(),
  realTokenReserves: z.string(),
  tokenTotalSupply: z.string(),
  /** 0-100, how close realSolReserves is to Pump.fun's ~85 SOL graduation threshold —
   *  informational only, never what actually decides graduation (the program's own
   *  `complete` flag is the sole source of truth for that, see PumpFunToken's own doc
   *  comment). Capped at 100 even if realSolReserves has since drifted past the threshold
   *  (a graduated curve's reserves can move independently once complete). */
  graduationProgressPct: z.number(),
  complete: z.boolean(),
  createdAt: z.string().datetime(),
  graduatedAt: z.string().datetime().nullable(),
});
export type PumpFunTokenSummary = z.infer<typeof PumpFunTokenSummarySchema>;

export const CandleSchema = z.object({
  bucketStart: z.string().datetime(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volumeUsd: z.number(),
});
export type Candle = z.infer<typeof CandleSchema>;

/**
 * Ranking weights and gates for /market/discover. Documented, not a black box — see
 * docs/MARKET_DATA.md#ranking for the formula these feed. Exported from here so the API
 * service and the documentation are guaranteed to describe the same numbers.
 */
export const DISCOVERY_RANKING = {
  weights: { volume: 0.4, momentum: 0.3, liquidity: 0.3 },
  /** A market below this liquidity is excluded from ranked results entirely. */
  minLiquidityUsd: 10_000,
  /** A price snapshot older than this is treated as stale and excluded from ranking. */
  maxStalenessMinutes: 30,
  /** Momentum's raw input is clamped to +/- this before weighting, so a huge percentage
   *  swing on a near-zero denominator can't dominate the score. */
  momentumClampPct: 50,
} as const;

/**
 * Discovery Score = w_volume * log10(1 + volume24h) + w_momentum * clamp(change24h) +
 * w_liquidity * log10(1 + liquidity) — see docs/MARKET_DATA.md#ranking for the full
 * rationale. Log-scaling volume/liquidity keeps one whale market from mathematically
 * dominating every other factor; clamping momentum keeps a tiny-denominator percentage
 * spike from doing the same. Returns null for a market this formula shouldn't rank at all
 * (below the liquidity gate, missing volume data entirely, or stale — see
 * DISCOVERY_RANKING.maxStalenessMinutes) rather than a misleading 0 or a ranking built on
 * a snapshot that's no longer current.
 *
 * `priceChange24hPct === null` does NOT exclude a market (as of 2026-09-26) — a market
 * genuinely has no 24h price-change figure yet for up to 24h after its very first indexed
 * swap (`recomputeRollups`'s `haveFullDay` gate, ingestion.ts), which was silently hiding
 * every freshly-seeded market from Discover entirely for its first day, real liquidity and
 * volume notwithstanding — confirmed live: BNB's whole seed list (added 2026-09-24, real
 * liquidity, real on-chain swaps happening) was invisible in `/market/discover` for exactly
 * this reason. Missing momentum now contributes 0 to the score (neutral, not a fabricated
 * "unchanged") rather than excluding the market — this only affects internal ranking, never
 * what's displayed: `toMarketSummary` still passes the raw `null` through untouched, and the
 * UI already renders that as "—", never a fake 0%, exactly as it did before this change
 * (see SelectableTokenRow's own "never invent a loss" test). `volume24hUsd === null` still
 * excludes: that means zero swaps have ever been indexed for this market at all, not
 * "missing one derived figure" — there's no real data to rank it on yet, new or not.
 */
export function computeDiscoveryScore(
  input: {
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    priceChange24hPct: number | null;
    lastPriceUpdateAt: Date | string | null;
  },
  now: Date = new Date(),
): number | null {
  const { volume24hUsd, liquidityUsd, priceChange24hPct, lastPriceUpdateAt } = input;
  if (isPriceStale(lastPriceUpdateAt, now)) return null;
  if (liquidityUsd === null || liquidityUsd < DISCOVERY_RANKING.minLiquidityUsd) return null;
  if (volume24hUsd === null) return null;

  const { weights, momentumClampPct } = DISCOVERY_RANKING;
  const clampedMomentum =
    priceChange24hPct === null ? 0 : Math.max(-momentumClampPct, Math.min(momentumClampPct, priceChange24hPct));

  return (
    weights.volume * Math.log10(1 + Math.max(0, volume24hUsd)) +
    weights.momentum * clampedMomentum +
    weights.liquidity * Math.log10(1 + Math.max(0, liquidityUsd))
  );
}

/** A price snapshot is stale once it's older than the configured window — see the "Stale" UI state in docs/MARKET_DATA.md. */
export function isPriceStale(lastPriceUpdateAt: Date | string | null, now: Date = new Date()): boolean {
  if (lastPriceUpdateAt === null) return true;
  const last = typeof lastPriceUpdateAt === 'string' ? new Date(lastPriceUpdateAt) : lastPriceUpdateAt;
  const ageMinutes = (now.getTime() - last.getTime()) / 60_000;
  // A negative age means lastPriceUpdateAt is in the future — clock skew or bad data, never
  // a legitimately "fresher than fresh" snapshot. Treat it defensively as stale rather than
  // let it read as the most current price on record.
  if (ageMinutes < 0) return true;
  return ageMinutes > DISCOVERY_RANKING.maxStalenessMinutes;
}
