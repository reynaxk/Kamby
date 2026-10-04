import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import type { SolanaTokenMarket } from '@kamby/db';
import {
  CandleSchema,
  computeDiscoveryScore,
  DISCOVERY_RANKING,
  identifierForChainId,
  isCuratedMarket,
  LARGE_TRADE_USD_THRESHOLD,
  pickPrimaryMarket,
  type Candle,
  type EvmChainConfig,
  type MarketSummary,
  type Timeframe,
  type TokenTraderConnection,
} from '@kamby/domain';
import { getConfiguredChains, type Env } from '../config/env';
import { toSocialActivity } from '../social/social.mapper';
import type { DiscoverQueryDto } from './dto/discover-query.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import { hideLookalikes } from './lookalike-filter';
import { findPrimaryMarket } from './primary-market';
import { toMarketSummary, toSolanaMarketSummary, type MarketRow } from './market.mapper';
import { REDIS_CLIENT } from '../redis/redis.module';
import { candlesOrThrow, fetchPoolCandles, GECKO_NETWORK_BY_CHAIN_ID, GECKO_OHLCV_TTL_SECONDS } from './gecko-ohlcv';
import { WatchlistService } from './watchlist.service';

/** Prices refresh roughly every 60s (workers' ingestion tick), so 10s staleness is invisible —
 *  but it collapses TickerBar's per-browser 20s polling into one query per 10s. */
const DISCOVER_CACHE_TTL_SECONDS = 10;
const TOKEN_TRADERS_CACHE_TTL_SECONDS = 15;

const MARKET_INCLUDE = { token: true, quoteToken: true, chain: true } as const;
const ACTIVITY_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true, chain: true } },
  trader: { include: { user: true } },
} as const;
/** How many recent trades a token page's "active traders" section considers — kept small
 *  and time-boxed (24h) so this is always a cheap, bounded query, never a full-history scan. */
const TOKEN_TRADER_LOOKBACK_HOURS = 24;
/** How many of a market's newest swaps are scanned for its most recent distinct traders. */
const RECENT_TRADER_SWAP_SCAN = 500;
/** Cached entries outlive their freshness window by this factor, served stale while a
 *  background refresh runs — see MarketService#cached. */
const STALE_RETENTION_MULTIPLIER = 30;
interface CacheEntry<T> {
  v: T;
  /** When the value was computed (epoch ms). */
  at: number;
}
/** "Recent large trades" look back this far — bounded so a market with none never scans its whole history. */
const LARGE_TRADE_LOOKBACK_DAYS = 7;

/** bucket width and lookback window per chart timeframe — see docs/MARKET_DATA.md#timeframes.
 *  `1m`/`5m` read from raw `swaps` (see `FINE_TIMEFRAMES` below), so their bucket width is
 *  genuinely the chart's candle width, not just a `candles`-table re-aggregation step; the
 *  rest keep the established "label names the lookback window, bucket chosen for a
 *  reasonable candle count" convention this file already used before 2026-09-27. */
const TIMEFRAME_CONFIG: Record<Timeframe, { bucket: string; lookback: string }> = {
  '1m': { bucket: '1 minute', lookback: '1 hour' },
  '5m': { bucket: '5 minutes', lookback: '6 hours' },
  '1H': { bucket: '5 minutes', lookback: '1 hour' },
  '4H': { bucket: '15 minutes', lookback: '4 hours' },
  '1D': { bucket: '1 hour', lookback: '1 day' },
  '1W': { bucket: '4 hours', lookback: '7 days' },
  '1M': { bucket: '1 day', lookback: '30 days' },
};

/** Genuinely finer than anything `candles` stores (that table's native bucket is 5 minutes —
 *  see `BUCKET_MINUTES` in apps/workers' ingestion.ts). These two read straight from `swaps`
 *  instead: real per-trade price/timestamp data already exists there, so this is honest,
 *  not-fabricated resolution, not a re-aggregation of already-coarsened data (which is
 *  mathematically impossible — you cannot recover 1-minute detail from 5-minute buckets). A
 *  thinly-traded market simply has empty buckets at this resolution, same as any real
 *  candlestick chart — never backfilled with a fake flat line. */
const FINE_TIMEFRAMES: ReadonlySet<Timeframe> = new Set(['1m', '5m']);

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);
  /** Per-process in-flight dedupe: a burst of identical cache misses runs one query, not N. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly watchlist: WatchlistService,
    private readonly config: ConfigService<Env, true>,
    // Optional so unit tests that don't care about caching can omit it; Nest always
    // injects the global REDIS_CLIENT in the running app.
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /** Cache-aside over Redis with stale-while-revalidate — same origin as
   *  LeaderboardService#cached (the leaderboard stayed at ~10-80ms under the 40-request burst
   *  that timed these endpoints out, 2026-09-29). Only for responses identical for every viewer.
   *
   *  An entry is fresh for `ttlSeconds`; after that it is still served *immediately* while one
   *  background refresh recomputes it (added 2026-09-30: the token-traders panel for the
   *  busiest pools, e.g. XDP at ~1,400 swaps a minute, takes ~8s to compute cold even with
   *  bounded queries, and every viewer used to wait for it each time the entry expired).
   *  Entries are kept STALE_RETENTION_MULTIPLIER x longer than their freshness window, so only
   *  the first request after a long quiet period or a cold start ever waits.
   *
   *  Redis failures fall through to Postgres; errors (e.g. NotFound) are never cached, and a
   *  failed background refresh keeps serving the last good value. */
  private async cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    if (!this.redis) return compute();
    const redisKey = `market:${key}`;
    let stale: { value: T } | null = null;
    try {
      const hit = await this.redis.get(redisKey);
      if (hit !== null) {
        const entry = JSON.parse(hit) as Partial<CacheEntry<T>>;
        if (typeof entry.at === 'number' && 'v' in entry) {
          if (Date.now() - entry.at < ttlSeconds * 1000) return entry.v as T;
          stale = { value: entry.v as T };
        }
      }
    } catch (error) {
      this.logger.warn(`Market cache read failed for ${redisKey} — computing fresh: ${String(error)}`);
    }

    const refresh = this.refreshEntry(redisKey, ttlSeconds, compute);
    if (stale) {
      refresh.catch((error: unknown) => this.logger.warn(`Background refresh failed for ${redisKey} — still serving the last value: ${String(error)}`));
      return stale.value;
    }
    return refresh;
  }

  /** One recompute per key at a time (a burst of identical misses runs one query, not N). */
  private refreshEntry<T>(redisKey: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(redisKey) as Promise<T> | undefined;
    if (pending) return pending;
    const run = (async () => {
      const value = await compute();
      try {
        const entry: CacheEntry<T> = { v: value, at: Date.now() };
        await this.redis!.set(redisKey, JSON.stringify(entry), 'EX', ttlSeconds * STALE_RETENTION_MULTIPLIER);
      } catch (error) {
        this.logger.warn(`Market cache write failed for ${redisKey}: ${String(error)}`);
      }
      return value;
    })().finally(() => this.inFlight.delete(redisKey));
    this.inFlight.set(redisKey, run);
    return run;
  }

  /** Public, read-only, chain-scoped config the frontend needs to build a real transaction
   *  itself (the Send modal's EVM USDC address per chain) — reuses `getConfiguredChains()`
   *  verbatim, the exact same addresses every trading service already trades against, never
   *  a second independently-sourced copy. rpcUrl/rpcUrlFallback are deliberately omitted:
   *  operational detail the frontend has no use for and shouldn't be handed unnecessarily. */
  getChains(): EvmChainConfig[] {
    return getConfiguredChains((key) => this.config.get(key, { infer: true })).map((c) => ({
      slug: c.slug,
      chainId: c.chainId,
      usdcAddress: c.usdcAddress,
    }));
  }

  /**
   * Ranked market opportunities. Phase 1's market count is small and bounded by design
   * (see docs/MARKET_DATA.md#token-discovery), so scoring/sorting happens in application
   * code after one bounded fetch — the honest, simple choice at this scale. Moving ranking
   * into a SQL-computed view (or a materialized, indexed score column) is the documented
   * next step once the tracked-market count stops being small.
   *
   * Merges TokenMarket (EVM) rows with SolanaTokenMarket rows — see that model's own doc
   * comment in schema.prisma. Both map onto MarketSummary's already chain-agnostic shape, so
   * scoring/sorting happens once, after mapping, rather than twice on two different row
   * shapes.
   */
  /**
   * Discovered (non-seed-list) EVM markets Kamby started tracking in the last `sinceHours`,
   * newest first, each with the time it was listed — the Graduated tab's "new pools". Held
   * to Discover's own bar: honest liquidity at or above the ranking minimum, fresh price, no
   * lookalikes of a vetted token (see hideLookalikes).
   */
  async recentlyListed(sinceHours: number, limit: number): Promise<(MarketSummary & { listedAtIso: string })[]> {
    return this.cached(`recently-listed:${sinceHours}:${limit}`, DISCOVER_CACHE_TTL_SECONDS, async () => {
      const since = new Date(Date.now() - sinceHours * 60 * 60_000);
      const rows = await prisma.tokenMarket.findMany({
        where: { createdAt: { gte: since }, liquidityUsd: { gte: DISCOVERY_RANKING.minLiquidityUsd } },
        include: MARKET_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: limit * 3, // headroom for what the filters below remove
      });
      const listedAt = new Map(rows.map((row) => [row.id, row.createdAt.toISOString()]));
      const candidates = primaryRowsOnly(rows)
        .filter((row) => !isCuratedMarket(row.chain.identifier, row.token.contractAddress))
        .map((row) => ({ id: row.id, summary: toMarketSummary(row) }))
        .filter(({ summary }) => !summary.isStale);
      const visible = new Set(hideLookalikes(candidates.map((c) => c.summary)));
      return candidates
        .filter((c) => visible.has(c.summary))
        .slice(0, limit)
        .map((c) => ({ ...c.summary, listedAtIso: listedAt.get(c.id)! }));
    });
  }

  async discover(query: DiscoverQueryDto): Promise<MarketSummary[]> {
    return this.cached(`discover:${query.sort}:${query.limit}:${query.search ?? ''}`, DISCOVER_CACHE_TTL_SECONDS, () =>
      this.computeDiscover(query),
    );
  }

  private async computeDiscover(query: DiscoverQueryDto): Promise<MarketSummary[]> {
    const [evmRows, solanaRows] = await Promise.all([
      prisma.tokenMarket.findMany({ include: MARKET_INCLUDE }),
      prisma.solanaTokenMarket.findMany(),
    ]);

    const evmFiltered = primaryRowsOnly(query.search ? evmRows.filter((row) => matchesSearch(row, query.search!)) : evmRows);
    const solanaFiltered = query.search ? solanaRows.filter((row) => matchesSolanaSearch(row, query.search!)) : solanaRows;

    // evmMarketId is carried alongside (never part of MarketSummary itself) purely so the
    // post-slice sparkline fetch below can key back into `candles` — SolanaTokenMarket rows
    // have no candle history (DexScreener-sourced snapshots, not on-chain ingestion), so they
    // carry `null` and simply get no sparkline, same as any EVM market too new for one.
    const allCandidates: { summary: MarketSummary; evmMarketId: string | null }[] = [
      ...evmFiltered.map((row) => ({ summary: toMarketSummary(row), evmMarketId: row.id })),
      ...solanaFiltered.map((row) => ({ summary: toSolanaMarketSummary(row), evmMarketId: null })),
    ];
    const visible = new Set(hideLookalikes(allCandidates.map((c) => c.summary)));
    const candidates = allCandidates.filter((c) => visible.has(c.summary));

    const scored = candidates
      .map((candidate) => ({
        ...candidate,
        score: computeDiscoveryScore({
          volume24hUsd: candidate.summary.volume24hUsd,
          liquidityUsd: candidate.summary.liquidityUsd,
          priceChange24hPct: candidate.summary.priceChange24hPct,
          lastPriceUpdateAt: candidate.summary.lastPriceUpdateAt,
        }),
      }))
      .filter((entry): entry is typeof entry & { score: number } => entry.score !== null);

    scored.sort((a, b) => compareBySort(a, b, query.sort));

    const page = scored.slice(0, query.limit);
    const recentCloses = await this.fetchRecentCloses(page.flatMap(({ evmMarketId }) => (evmMarketId ? [evmMarketId] : [])));
    return page.map(({ summary, evmMarketId, score }) => ({
      ...summary,
      discoveryScore: score,
      recentCloses: evmMarketId ? recentCloses.get(evmMarketId) : undefined,
    }));
  }

  /**
   * One batched query for the whole returned page's sparklines (`Sparkline.tsx`), never a
   * per-row query — see docs/MARKET_DATA.md#token-discovery's "one bounded fetch" precedent
   * this file already follows. Scoped to exactly the page being returned (post-slice), not
   * every scored candidate, since most of those are never rendered.
   *
   * Sampled down from the raw 5-minute candles to ~24 points (roughly hourly) rather than
   * returned in full: a sparkline is ~96px wide, so 288 raw 5-min points over 24h would be
   * pure visual noise and a needlessly large response for what's meant to be a glance-level
   * trend line, not the real chart (that's KambyChart, reading full-resolution history via
   * getHistory). A market absent from the returned map (too new for 24h of candles, or none
   * at all) simply gets no `recentCloses` — Sparkline's own "renders nothing" path handles
   * that, never a fabricated flat line.
   */
  private async fetchRecentCloses(tokenMarketIds: string[]): Promise<Map<string, number[]>> {
    if (tokenMarketIds.length === 0) return new Map();
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const candles = await prisma.candle.findMany({
      where: { tokenMarketId: { in: tokenMarketIds }, bucketStart: { gte: since24h } },
      orderBy: { bucketStart: 'asc' },
      select: { tokenMarketId: true, close: true },
    });

    const byMarket = new Map<string, number[]>();
    for (const candle of candles) {
      const closes = byMarket.get(candle.tokenMarketId) ?? [];
      closes.push(Number(candle.close));
      byMarket.set(candle.tokenMarketId, closes);
    }

    const SPARKLINE_POINTS = 24;
    const sampled = new Map<string, number[]>();
    for (const [tokenMarketId, closes] of byMarket) {
      if (closes.length < 2) continue; // Sparkline itself also guards this; skip building a useless 0/1-point entry.
      if (closes.length <= SPARKLINE_POINTS) {
        sampled.set(tokenMarketId, closes);
        continue;
      }
      const step = (closes.length - 1) / (SPARKLINE_POINTS - 1);
      const points = Array.from({ length: SPARKLINE_POINTS }, (_, i) => closes[Math.round(i * step)]!);
      sampled.set(tokenMarketId, points);
    }
    return sampled;
  }

  /** `chainId` is required and never defaulted here — see SafetyService.assertTradable's
   *  comment for why: `TokenMarket` is only unique per `(chainId, contractAddress)`, so an
   *  unscoped lookup could silently resolve to the wrong chain's market once the same
   *  address exists on two chains. */
  async getToken(address: string, chainId: number): Promise<MarketSummary> {
    assertAddressShape(address);
    const row = await findPrimaryMarket(requireChainIdentifier(chainId), address, (where) =>
      prisma.tokenMarket.findFirst({ where, include: MARKET_INCLUDE, orderBy: { liquidityUsd: 'desc' } }),
    );
    if (!row) throw new NotFoundException(`No tracked market for token address "${address}"`);
    return toMarketSummary(row);
  }

  /**
   * Phase 5 — see docs/TRADER_INTELLIGENCE.md#token-to-trader. Three bounded queries (never
   * a per-trader loop): the most recently active distinct traders, traders active on this
   * token in the last 24h, and this token's own recent large trades. `uniqueTraders24h` is
   * read straight off TokenMarket's own cached column — never recomputed here.
   */
  async getTokenTraders(address: string, chainId: number, limit: number): Promise<TokenTraderConnection> {
    return this.cached(`token-traders:${chainId}:${address.toLowerCase()}:${limit}`, TOKEN_TRADERS_CACHE_TTL_SECONDS, () =>
      this.computeTokenTraders(address, chainId, limit),
    );
  }

  private async computeTokenTraders(address: string, chainId: number, limit: number): Promise<TokenTraderConnection> {
    assertAddressShape(address);
    const market = await findPrimaryMarket(requireChainIdentifier(chainId), address, (where) =>
      prisma.tokenMarket.findFirst({ where, include: MARKET_INCLUDE, orderBy: { liquidityUsd: 'desc' } }),
    );
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);

    const since = new Date(Date.now() - TOKEN_TRADER_LOOKBACK_HOURS * 60 * 60_000);
    const largeTradesSince = new Date(Date.now() - LARGE_TRADE_LOOKBACK_DAYS * 24 * 60 * 60_000);

    // Every query here is bounded by the (token_market_id, block_timestamp) index — found
    // 2026-09-30 taking 10-19s cold for WETH/cbBTC/XDP under load: Prisma's `distinct` option
    // dedupes in JavaScript after loading *every* matching row (a market's whole swap history),
    // and the buyer/seller counts fetched every distinct trader just to count them.
    const [recentSwaps, activeGrouped, largeTradeRows, watcherCount, [counts]] = await Promise.all([
      // The newest swaps, deduped here — the most recent distinct traders are always in them.
      prisma.swap.findMany({
        where: { tokenMarketId: market.id, traderAddress: { not: null } },
        orderBy: { blockTimestamp: 'desc' },
        take: RECENT_TRADER_SWAP_SCAN,
        select: { traderAddress: true, blockTimestamp: true },
      }),
      prisma.swap.groupBy({
        by: ['traderAddress'],
        where: {
          tokenMarketId: market.id,
          traderAddress: { not: null },
          blockTimestamp: { gte: since },
        },
        _count: { _all: true },
        _max: { blockTimestamp: true },
        orderBy: { _count: { traderAddress: 'desc' } },
        take: limit,
      }),
      prisma.swap.findMany({
        where: { tokenMarketId: market.id, volumeUsd: { gte: LARGE_TRADE_USD_THRESHOLD }, blockTimestamp: { gte: largeTradesSince } },
        orderBy: { blockTimestamp: 'desc' },
        take: limit,
        include: ACTIVITY_INCLUDE,
      }),
      this.watchlist.getWatcherCount(market.id),
      // Buy/sell counts + distinct buyer/seller counts over the same 24h window, in one pass.
      prisma.$queryRaw<{ buys: bigint; sells: bigint; buyers: bigint; sellers: bigint }[]>`
        SELECT
          COUNT(*) FILTER (WHERE side = 'buy') AS buys,
          COUNT(*) FILTER (WHERE side = 'sell') AS sells,
          COUNT(DISTINCT trader_address) FILTER (WHERE side = 'buy') AS buyers,
          COUNT(DISTINCT trader_address) FILTER (WHERE side = 'sell') AS sellers
        FROM swaps
        WHERE token_market_id = ${market.id} AND block_timestamp >= ${since}
      `,
    ]);

    const recentTraders: { address: string; lastTradeAt: Date }[] = [];
    const seen = new Set<string>();
    for (const swap of recentSwaps) {
      if (!swap.traderAddress || seen.has(swap.traderAddress)) continue;
      seen.add(swap.traderAddress);
      recentTraders.push({ address: swap.traderAddress, lastTradeAt: swap.blockTimestamp });
      if (recentTraders.length === limit) break;
    }

    const profileAddresses = [...new Set([...recentTraders.map((t) => t.address), ...activeGrouped.flatMap((g) => (g.traderAddress ? [g.traderAddress] : []))])];
    const wallets =
      profileAddresses.length > 0
        ? await prisma.wallet.findMany({ where: { address: { in: profileAddresses } }, include: { user: true } })
        : [];
    const walletByAddress = new Map(wallets.map((w) => [w.address, w]));

    const largeTradeLikeCounts = await batchLikeCounts(largeTradeRows.map((r) => r.id));

    return {
      uniqueTraders24h: market.uniqueTraders24h,
      recentTraders: recentTraders.map((t) => {
        const wallet = walletByAddress.get(t.address);
        return {
          address: t.address,
          username: wallet?.user?.username ?? null,
          avatarUrl: wallet?.user?.avatarUrl ?? null,
          lastTradeAt: t.lastTradeAt.toISOString(),
          tradeCount24h: null,
        };
      }),
      activeTraders: activeGrouped.flatMap((g) => {
        if (!g.traderAddress || !g._max.blockTimestamp) return [];
        const wallet = walletByAddress.get(g.traderAddress);
        return [
          {
            address: g.traderAddress,
            username: wallet?.user?.username ?? null,
            avatarUrl: wallet?.user?.avatarUrl ?? null,
            lastTradeAt: g._max.blockTimestamp.toISOString(),
            tradeCount24h: g._count._all,
          },
        ];
      }),
      recentLargeTrades: largeTradeRows.map((row) =>
        toSocialActivity(row, largeTradeLikeCounts.get(row.id) ?? 0, null),
      ),
      watcherCount,
      buyCount24h: Number(counts?.buys ?? 0),
      sellCount24h: Number(counts?.sells ?? 0),
      buyerCount24h: Number(counts?.buyers ?? 0),
      sellerCount24h: Number(counts?.sellers ?? 0),
    };
  }

  async getHistory(address: string, chainId: number, timeframe: Timeframe): Promise<Candle[]> {
    assertAddressShape(address);
    const market = await findPrimaryMarket(requireChainIdentifier(chainId), address, (where) =>
      prisma.tokenMarket.findFirst({ where, orderBy: { liquidityUsd: 'desc' } }),
    );
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);

    // Aggregator-priced coins (Aerodrome, Uniswap v4, PancakeSwap v2…) have no indexed swaps —
    // their candles come from GeckoTerminal, cached and shared by every viewer.
    if (market.dex?.startsWith('agg:')) {
      const network = GECKO_NETWORK_BY_CHAIN_ID[chainId];
      if (!network) return [];
      return this.cached(`agg-history:${market.id}:${timeframe}`, GECKO_OHLCV_TTL_SECONDS[timeframe], () =>
        candlesOrThrow(fetchPoolCandles(network, market.pairAddress, address, timeframe)),
      ).catch(() => []);
    }

    const { bucket, lookback } = TIMEFRAME_CONFIG[timeframe];
    type CandleRow = { bucket_start: Date; open: unknown; high: unknown; low: unknown; close: unknown; volume_usd: unknown };
    const rows = FINE_TIMEFRAMES.has(timeframe)
      ? await prisma.$queryRaw<CandleRow[]>`
          SELECT
            time_bucket(${bucket}::interval, block_timestamp) AS bucket_start,
            (array_agg(price_usd ORDER BY block_timestamp ASC))[1] AS open,
            MAX(price_usd) AS high,
            MIN(price_usd) AS low,
            (array_agg(price_usd ORDER BY block_timestamp DESC))[1] AS close,
            SUM(volume_usd) AS volume_usd
          FROM swaps
          WHERE token_market_id = ${market.id}::text
            AND block_timestamp >= NOW() - ${lookback}::interval
          GROUP BY 1
          ORDER BY 1 ASC
        `
      : await prisma.$queryRaw<CandleRow[]>`
          SELECT
            time_bucket(${bucket}::interval, bucket_start) AS bucket_start,
            (array_agg(open ORDER BY bucket_start ASC))[1] AS open,
            MAX(high) AS high,
            MIN(low) AS low,
            (array_agg(close ORDER BY bucket_start DESC))[1] AS close,
            SUM(volume_usd) AS volume_usd
          FROM candles
          WHERE token_market_id = ${market.id}::text
            AND bucket_start >= NOW() - ${lookback}::interval
          GROUP BY 1
          ORDER BY 1 ASC
        `;

    const candles = rows.map((r) =>
      CandleSchema.parse({
        bucketStart: r.bucket_start.toISOString(),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volumeUsd: Number(r.volume_usd),
      }),
    );
    // A just-listed coin has almost no indexed swaps yet, so its chart sat on "Not enough price
    // history" for hours — fall back to GeckoTerminal's candles for the same pool until ours fill in.
    const network = GECKO_NETWORK_BY_CHAIN_ID[chainId];
    if (candles.length < 2 && network) {
      const fallback = await this.cached(`young-history:${market.id}:${timeframe}`, GECKO_OHLCV_TTL_SECONDS[timeframe], () =>
        candlesOrThrow(fetchPoolCandles(network, market.pairAddress, address, timeframe)),
      ).catch(() => [] as Candle[]);
      if (fallback.length >= 2) return fallback;
    }
    return candles;
  }

  /** Deliberately not chain-scoped: unlike getToken/getTokenTraders/getHistory (a single
   *  "the" answer via findFirst, where a cross-chain collision would silently pick the
   *  wrong one), this returns a list — matches from every chain are all legitimate results,
   *  each self-identifying its own chain via `chainIdentifier` in the response. Same
   *  reasoning as `discover()` above, including the EVM/Solana merge. */
  async search(query: SearchQueryDto): Promise<MarketSummary[]> {
    const [evmRows, solanaRows] = await Promise.all([
      prisma.tokenMarket.findMany({
        where: {
          OR: [
            { token: { symbol: { contains: query.q, mode: 'insensitive' } } },
            { token: { name: { contains: query.q, mode: 'insensitive' } } },
            { token: { contractAddress: { equals: query.q, mode: 'insensitive' } } },
          ],
        },
        include: MARKET_INCLUDE,
        orderBy: { liquidityUsd: 'desc' },
        take: query.limit,
      }),
      prisma.solanaTokenMarket.findMany({
        where: {
          OR: [
            { symbol: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
            { mintAddress: { equals: query.q, mode: 'insensitive' } },
          ],
        },
        orderBy: { liquidityUsd: 'desc' },
        take: query.limit,
      }),
    ]);

    const summaries = [...primaryRowsOnly(evmRows).map((row) => toMarketSummary(row)), ...solanaRows.map((row) => toSolanaMarketSummary(row))];
    summaries.sort((a, b) => numDesc(a.liquidityUsd, b.liquidityUsd));
    // An exact-address search is someone asking for one specific token — never hide it.
    // A name search gets the same bar as Discover: no lookalikes, and nothing below
    // Discover's liquidity minimum (a pool holding a few dollars isn't a tradeable market).
    const isAddressLookup = EVM_ADDRESS_PATTERN.test(query.q) || SOLANA_MINT_PATTERN.test(query.q);
    if (isAddressLookup) return summaries.slice(0, query.limit);
    const liquid = summaries.filter((m) => m.liquidityUsd !== null && m.liquidityUsd >= DISCOVERY_RANKING.minLiquidityUsd);
    return hideLookalikes(liquid).slice(0, query.limit);
  }
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function assertAddressShape(address: string): void {
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new BadRequestException(`"${address}" is not a valid contract address`);
  }
}

/** `TokenMarket.chainId` is Chain's own internal autoincrement id, not the real numeric EVM
 *  chain id this file's methods receive — see identifierForChainId's own doc comment for
 *  the real incident (every token detail/history/traders lookup silently 404ing) this
 *  fixes. Every `TokenMarket` lookup below that needs to scope to one chain does it through
 *  this — via the `chain` relation's real `identifier` — never a bare `chainId: chainId`. */
function requireChainIdentifier(chainId: number): string {
  const identifier = identifierForChainId(chainId);
  if (!identifier) throw new NotFoundException(`Chain id ${chainId} is not a chain Kamby trades on`);
  return identifier;
}

/**
 * One row per token: a token with several tracked markets keeps only its primary one (seed
 * pool, else most liquid — see pickPrimaryMarket). Found 2026-09-30: WBNB listed twice (its
 * seed WBNB/USDC pool and a discovered WBNB/BNCB one), which also gave React duplicate keys
 * and left a stale WBNB row stuck at the top of other tabs.
 */
function primaryRowsOnly<T extends Pick<MarketRow, 'pairAddress' | 'liquidityUsd' | 'chain' | 'token'>>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.chain.identifier}:${row.token.contractAddress.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const keep = new Set<T>();
  for (const group of groups.values()) {
    const primary = group.length === 1 ? group[0] : pickPrimaryMarket(group[0]!.chain.identifier, group[0]!.token.contractAddress, group);
    if (primary) keep.add(primary);
  }
  return rows.filter((row) => keep.has(row));
}

function matchesSearch(row: MarketRow, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    (row.token.symbol?.toLowerCase().includes(needle) ?? false) ||
    (row.token.name?.toLowerCase().includes(needle) ?? false) ||
    row.token.contractAddress.toLowerCase() === needle
  );
}

function matchesSolanaSearch(row: SolanaTokenMarket, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    (row.symbol?.toLowerCase().includes(needle) ?? false) ||
    (row.name?.toLowerCase().includes(needle) ?? false) ||
    row.mintAddress.toLowerCase() === needle
  );
}

function compareBySort(
  a: { summary: MarketSummary; score: number },
  b: { summary: MarketSummary; score: number },
  sort: DiscoverQueryDto['sort'],
): number {
  switch (sort) {
    case 'volume':
      return numDesc(a.summary.volume24hUsd, b.summary.volume24hUsd);
    case 'liquidity':
      return numDesc(a.summary.liquidityUsd, b.summary.liquidityUsd);
    case 'priceChange':
      return numDesc(a.summary.priceChange24hPct, b.summary.priceChange24hPct);
    case 'score':
    default:
      return b.score - a.score;
  }
}

function numDesc(a: number | null, b: number | null): number {
  const an = a === null ? -Infinity : a;
  const bn = b === null ? -Infinity : b;
  return bn - an;
}

/** One groupBy for a bounded set of swap ids — same "batch, never per-row" shape as
 *  ActivityService's own like-count batching. */
async function batchLikeCounts(swapIds: string[]): Promise<Map<string, number>> {
  if (swapIds.length === 0) return new Map();
  const counts = await prisma.activityLike.groupBy({
    by: ['swapId'],
    where: { swapId: { in: swapIds } },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.swapId, c._count._all]));
}
