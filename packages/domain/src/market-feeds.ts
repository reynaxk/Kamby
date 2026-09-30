import type { MarketSummary, PumpFunTokenSummary } from './market';
import { PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS } from './trading';

/**
 * The terminal's five discovery tabs and the live stream behind them — see
 * docs/MARKET_DATA.md#market-feeds. Every feed comes from a free source (Pyth Hermes,
 * GeckoTerminal, PumpPortal, Kamby's own vetted markets), never paid RPC; paid RPC is
 * reserved for trade execution, balances and broadcasting.
 */
export const MARKET_FEED_TABS = ['trending', 'trenches', 'bonding', 'graduated', 'crypto'] as const;
export type MarketFeedTab = (typeof MARKET_FEED_TABS)[number];

/** Worker -> API: Pump.fun bonding-curve tokens whose state changed since the last batch
 *  (created, traded or graduated), already in the shape the Trenches/Bonding tabs render. */
export const PUMPFUN_REALTIME_CHANNEL = 'kamby:pumpfun:updates';
export interface PumpFunLiveBatch {
  tokens: PumpFunTokenSummary[];
  atIso: string;
}

export const CRYPTO_MAJORS = ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX'] as const;
export type CryptoMajor = (typeof CRYPTO_MAJORS)[number];

export interface CryptoPrice {
  symbol: CryptoMajor;
  priceUsd: number;
  /** Pyth's own confidence interval, in USD — how far the true price may be from `priceUsd`. */
  confidenceUsd: number;
  publishTimeIso: string;
}

/**
 * A Trending/Graduated row. `vetted` = one of Kamby's own tracked markets (seed list /
 * curated Solana, full chart + trade flow). `new` = a pool found through GeckoTerminal or a
 * just-graduated Pump.fun coin, shown with a "New · high risk" badge: it cleared the
 * liquidity floor and the lookalike filter, and nothing more — no rug or honeypot checks.
 */
export type FeedMarket = MarketSummary & {
  listing: 'vetted' | 'new';
  /** The pool this row was priced from — present for `new` rows. */
  pairAddress?: string | null;
  pairCreatedAtIso?: string | null;
};

/** Server-Sent Event names on GET /v1/market/feeds/stream, and each one's `data`. */
export interface MarketFeedEvents {
  trending: { markets: FeedMarket[]; atIso: string };
  graduated: { markets: FeedMarket[]; atIso: string };
  trenches: { tokens: PumpFunTokenSummary[]; atIso: string };
  bonding: { tokens: PumpFunTokenSummary[]; atIso: string };
  crypto: { prices: CryptoPrice[]; atIso: string };
  /** Incremental: merge into trenches/bonding by mintAddress. */
  pumpfun: PumpFunLiveBatch;
  heartbeat: { atIso: string };
}

/** Minimum liquidity for a `new` Trending/Graduated row — same floor as Discover's ranking
 *  (DISCOVERY_RANKING.minLiquidityUsd). */
export const NEW_PAIR_MIN_LIQUIDITY_USD = 10_000;

/** 0-100 progress toward Pump.fun's ~85 SOL graduation threshold, from real SOL reserves
 *  (lamports, as a string). Informational only — the program's own `complete` flag decides
 *  graduation. Shared by apps/api (trenches queries) and apps/workers (live batches) so the
 *  two never disagree. */
export function pumpFunGraduationProgressPct(realSolReservesLamports: string): number {
  const raised = BigInt(realSolReservesLamports);
  if (raised <= 0n) return 0;
  const bps = (raised * 10_000n) / PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS;
  return Math.min(100, Number(bps) / 100);
}
