import type { MarketSummary, PumpFunTokenSummary } from './market';
import { PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS } from './trading';

/**
 * The terminal's five discovery tabs and the live stream behind them — see
 * docs/MARKET_DATA.md#market-feeds. Every feed comes from a free source (Coinbase's public
 * ticker, GeckoTerminal, PumpPortal, Kamby's own markets read over free public RPC), never
 * paid RPC; paid RPC is reserved for trade execution, balances and broadcasting.
 */
export const MARKET_FEED_TABS = ['trending', 'trenches', 'bonding', 'graduated', 'xxxrisk', 'crypto'] as const;
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

/**
 * An "XXXRisk" row (user spec 2026-10-03): a Pump.fun coin under XXXRISK_FILTER.maxAgeSeconds
 * old with $1K–3K in its curve and a $5K–15K market cap — the earliest, riskiest launches,
 * shown below Kamby's normal safety bar on purpose and labeled as such.
 */
export interface XxxRiskToken {
  mintAddress: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  ageSeconds: number;
  /** SOL in the bonding curve, in USD. */
  liquidityUsd: number;
  marketCapUsd: number;
  /** Jupiter's last-5-minute buy + sell volume (its shortest window). */
  volume5mUsd: number | null;
  traders5m: number | null;
  /** Rug-risk flags; empty = none of these checks tripped. */
  riskFlags: XxxRiskFlag[];
}
export type XxxRiskFlag = 'mintable' | 'freezable' | 'dev-holds-over-20pct' | 'top-holders-over-50pct' | 'unverified-audit';

/** Widened 2026-10-04 (user: "I want more coins") from <5 min, $1–3K, $5–15K. */
export const XXXRISK_FILTER = {
  maxAgeSeconds: 600,
  minLiquidityUsd: 500,
  maxLiquidityUsd: 5_000,
  minMarketCapUsd: 4_000,
  maxMarketCapUsd: 25_000,
  limit: 20,
} as const;

/** Server-Sent Event names on GET /v1/market/feeds/stream, and each one's `data`. */
export interface MarketFeedEvents {
  trending: { markets: FeedMarket[]; atIso: string };
  /** `markets`: Base/BNB pools Kamby started tracking in the last NEW_MARKET_WINDOW_HOURS
   *  (tradeable, `listing: 'new'`). `pumpfun`: coins that just left Pump.fun's bonding
   *  curve (tradeable on Solana through Jupiter). */
  graduated: { markets: FeedMarket[]; pumpfun: PumpFunTokenSummary[]; atIso: string };
  trenches: { tokens: PumpFunTokenSummary[]; atIso: string };
  bonding: { tokens: PumpFunTokenSummary[]; atIso: string };
  xxxrisk: { tokens: XxxRiskToken[]; atIso: string };
  crypto: { prices: CryptoPrice[]; atIso: string };
  /** Incremental: merge into trenches/bonding by mintAddress. */
  pumpfun: PumpFunLiveBatch;
  /** Incremental (2026-10-05): what changed in a tab since the viewer's last state. For each of
   *  the tab's lists: the new `order` of row keys, and in `rows` a full row for each key new to
   *  the list or only the changed fields of an existing one. Keys: `${chainIdentifier}:${tokenAddress}`
   *  for markets, `mintAddress` for Pump.fun/XXXRisk tokens. */
  listpatch: { tab: FeedListTab; lists: Record<string, { order: string[]; rows: Record<string, Record<string, unknown>> }>; atIso: string };
  heartbeat: { atIso: string };
}

/** Every tab's full state — GET /v1/market/feeds, and what the stream keeps current. */
export type MarketFeedSnapshot = Omit<MarketFeedEvents, 'pumpfun' | 'heartbeat' | 'listpatch'>;

/** The tabs sent as patches after their first snapshot, and the key of each row in their lists. */
export type FeedListTab = 'trending' | 'graduated' | 'trenches' | 'bonding' | 'xxxrisk';
export const FEED_LIST_FIELDS: Record<FeedListTab, readonly string[]> = {
  trending: ['markets'],
  graduated: ['markets', 'pumpfun'],
  trenches: ['tokens'],
  bonding: ['tokens'],
  xxxrisk: ['tokens'],
};
export function feedRowKey(row: { chainIdentifier?: string; tokenAddress?: string; mintAddress?: string }): string {
  return row.mintAddress ?? `${row.chainIdentifier}:${row.tokenAddress}`;
}

type Row = Record<string, unknown>;

/** Change on every row every rebuild but are never shown in the lists — left out of patches
 *  (a new row still carries them; the next full snapshot refreshes them). */
const UNSENT_FIELDS = new Set(['lastPriceUpdateAt', 'discoveryScore']);
type ListPatch = { order: string[]; rows: Record<string, Row> };

/** The patch turning list `prev` into `next`, or null when nothing changed. */
export function diffFeedList(prev: readonly Row[], next: readonly Row[]): ListPatch | null {
  const before = new Map(prev.map((r) => [feedRowKey(r), r]));
  const order = next.map((r) => feedRowKey(r));
  const rows: Record<string, Row> = {};
  for (const row of next) {
    const key = feedRowKey(row);
    const old = before.get(key);
    if (!old) {
      rows[key] = row;
      continue;
    }
    const changed: Row = {};
    for (const field of Object.keys(row)) {
      if (UNSENT_FIELDS.has(field)) continue;
      if (JSON.stringify(row[field]) !== JSON.stringify(old[field])) changed[field] = row[field];
    }
    if (Object.keys(changed).length > 0) rows[key] = changed;
  }
  const sameOrder = order.length === prev.length && order.every((k, i) => k === feedRowKey(prev[i]!));
  return sameOrder && Object.keys(rows).length === 0 ? null : { order, rows };
}

/** Applies a list patch; null when a key is neither in the current list nor the patch (resync needed). */
export function applyFeedList(current: readonly Row[], patch: ListPatch): Row[] | null {
  const byKey = new Map(current.map((r) => [feedRowKey(r), r]));
  const out: Row[] = [];
  for (const key of patch.order) {
    const base = byKey.get(key);
    const delta = patch.rows[key];
    if (!base && !delta) return null;
    out.push(base ? (delta ? { ...base, ...delta } : base) : delta!);
  }
  return out;
}

/** Every tab empty — the first paint when the snapshot fetch failed; the stream fills it in. */
export function emptyMarketFeeds(): MarketFeedSnapshot {
  const atIso = new Date(0).toISOString();
  return {
    trending: { markets: [], atIso },
    graduated: { markets: [], pumpfun: [], atIso },
    trenches: { tokens: [], atIso },
    bonding: { tokens: [], atIso },
    xxxrisk: { tokens: [], atIso },
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

/** One of a coin's largest holders (GET /market/holders/:chain/:address). */
export interface TokenHolder {
  /** The holder's wallet (on Solana the token account's owner, not the token account). */
  address: string;
  /** Tokens held, in whole-token units. */
  balance: number;
  /** Share of total supply, 0–100. */
  percent: number;
  /** A contract (pool, locker, bridge) — never labelled as a whale. */
  isContract: boolean;
  /** The source's label for a known address, e.g. a DEX pool or exchange. */
  tag: string | null;
}

export interface TokenHolders {
  /** Total holders, when the source knows it. */
  holderCount: number | null;
  /** Largest first, at most 20. */
  holders: TokenHolder[];
  atIso: string;
}

/** Position-size labels (owner definition 2026-10-04): $1M+ whale, $500K+ shark, $100K+ fish. */
export type HolderTier = 'whale' | 'shark' | 'fish';
export const HOLDER_TIERS: readonly { tier: HolderTier; minUsd: number }[] = [
  { tier: 'whale', minUsd: 1_000_000 },
  { tier: 'shark', minUsd: 500_000 },
  { tier: 'fish', minUsd: 100_000 },
];

/** The label for a position worth `valueUsd`, or null below $100K. */
export function holderTier(valueUsd: number): HolderTier | null {
  if (!Number.isFinite(valueUsd)) return null;
  return HOLDER_TIERS.find((t) => valueUsd >= t.minUsd)?.tier ?? null;
}
