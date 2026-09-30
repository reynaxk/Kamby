import type { MarketSummary, PumpFunTokenSummary } from './market';
import { PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS } from './trading';

/**
 * The terminal's five discovery tabs and the live stream behind them — see
 * docs/MARKET_DATA.md#market-feeds. Every feed comes from a free source (Coinbase's public
 * ticker, GeckoTerminal, PumpPortal, Kamby's own markets read over free public RPC), never
 * paid RPC; paid RPC is reserved for trade execution, balances and broadcasting.
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

/**
 * A major's spot price from Coinbase Exchange's public ticker feed — free, keyless, and not
 * geo-blocked from Kamby's US-hosted API. (Pyth's Hermes, the first choice, started
 * answering 401 without an API key; Binance blocks US IPs.)
 */
export interface CryptoPrice {
  symbol: CryptoMajor;
  priceUsd: number;
  /** vs. Coinbase's own 24h open; null until the first ticker with an open arrives. */
  change24hPct: number | null;
  updatedAtIso: string;
}

/**
 * A Trending/Graduated row. `vetted` = one of Kamby's own tracked markets (seed list /
 * curated Solana, full chart + trade flow). `new` = a pool found through GeckoTerminal or a
 * just-graduated Pump.fun coin, shown with a "New · high risk" badge: it cleared the
 * liquidity floor and the lookalike filter, and nothing more — no rug or honeypot checks.
 */
export type FeedMarket = MarketSummary & {
  listing: 'vetted' | 'new';
  /** When Kamby started tracking this market — present for Graduated tab rows. */
  listedAtIso?: string | null;
};

/** Server-Sent Event names on GET /v1/market/feeds/stream, and each one's `data`. */
export interface MarketFeedEvents {
  trending: { markets: FeedMarket[]; atIso: string };
  /** `markets`: Base/BNB pools Kamby started tracking in the last NEW_MARKET_WINDOW_HOURS
   *  (tradeable, `listing: 'new'`). `pumpfun`: coins that just left Pump.fun's bonding
   *  curve (tradeable on Solana through Jupiter). */
  graduated: { markets: FeedMarket[]; pumpfun: PumpFunTokenSummary[]; atIso: string };
  trenches: { tokens: PumpFunTokenSummary[]; atIso: string };
  bonding: { tokens: PumpFunTokenSummary[]; atIso: string };
  crypto: { prices: CryptoPrice[]; atIso: string };
  /** Incremental: merge into trenches/bonding by mintAddress. */
  pumpfun: PumpFunLiveBatch;
  heartbeat: { atIso: string };
}

/** Every tab's full state — GET /v1/market/feeds, and what the stream keeps current. */
export type MarketFeedSnapshot = Omit<MarketFeedEvents, 'pumpfun' | 'heartbeat'>;

/** Every tab empty — the first paint when the snapshot fetch failed; the stream fills it in. */
export function emptyMarketFeeds(): MarketFeedSnapshot {
  const atIso = new Date(0).toISOString();
  return {
    trending: { markets: [], atIso },
    graduated: { markets: [], pumpfun: [], atIso },
    trenches: { tokens: [], atIso },
    bonding: { tokens: [], atIso },
    crypto: { prices: [], atIso },
  };
}

/** Minimum liquidity for a `new` Trending/Graduated row — same floor as Discover's ranking
 *  (DISCOVERY_RANKING.minLiquidityUsd). */
export const NEW_PAIR_MIN_LIQUIDITY_USD = 10_000;

/** A discovered (non-vetted) market counts as "new" for the Graduated tab this long after
 *  Kamby started tracking it. */
export const NEW_MARKET_WINDOW_HOURS = 72;

/** Minimum real two-sided trading for GeckoTerminal-sourced pools before Kamby tracks them —
 *  a honeypot (nobody can sell) or a dust pool can't meet the seller count. */
export const NEW_PAIR_MIN_BUYERS_24H = 20;
export const NEW_PAIR_MIN_SELLERS_24H = 10;

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
