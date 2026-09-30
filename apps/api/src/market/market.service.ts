import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import type { SolanaTokenMarket } from '@kamby/db';
import {
  CandleSchema,
  computeDiscoveryScore,
  identifierForChainId,
  LARGE_TRADE_USD_THRESHOLD,
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
import { toMarketSummary, toSolanaMarketSummary, type MarketRow } from './market.mapper';
import { REDIS_CLIENT } from '../redis/redis.module';
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

  /** Cache-aside over Redis — same shape as LeaderboardService#cached, which is why the
   *  leaderboard stayed at ~10-80ms under the 40-request burst that timed these endpoints out
   *  (2026-09-29). Only for responses identical for every viewer. Redis failures fall through
   *  to Postgres; errors (e.g. NotFound) are never cached. */
  private async cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    if (!this.redis) return compute();
    const redisKey = `market:${key}`;
    try {
      const hit = await this.redis.get(redisKey);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.logger.warn(`Market cache read failed for ${redisKey} — computing fresh: ${String(error)}`);
    }

    const pending = this.inFlight.get(redisKey) as Promise<T> | undefined;
    if (pending) return pending;

    const run = (async () => {
      const value = await compute();
      try {
        await this.redis!.set(redisKey, JSON.stringify(value), 'EX', ttlSeconds);
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

    const evmFiltered = query.search ? evmRows.filter((row) => matchesSearch(row, query.search!)) : evmRows;
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
    const row = await prisma.tokenMarket.findFirst({
      where: { chain: { identifier: requireChainIdentifier(chainId) }, token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      include: MARKET_INCLUDE,
      orderBy: { liquidityUsd: 'desc' },
    });
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
    const market = await prisma.tokenMarket.findFirst({
      where: { chain: { identifier: requireChainIdentifier(chainId) }, token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      include: MARKET_INCLUDE,
      orderBy: { liquidityUsd: 'desc' },
    });
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);

    const since = new Date(Date.now() - TOKEN_TRADER_LOOKBACK_HOURS * 60 * 60_000);

    const [recentRows, activeGrouped, largeTradeRows, watcherCount, buyCount24h, sellCount24h, buyerGrouped, sellerGrouped] = await Promise.all([
      // distinct + orderBy gives the N most-recently-active *distinct* traders in one query.
      prisma.swap.findMany({
        where: { tokenMarketId: market.id, traderAddress: { not: null } },
        orderBy: { blockTimestamp: 'desc' },
        distinct: ['traderAddress'],
        take: limit,
        include: { trader: { include: { user: true } } },
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
        where: { tokenMarketId: market.id, volumeUsd: { gte: LARGE_TRADE_USD_THRESHOLD } },
        orderBy: { blockTimestamp: 'desc' },
        take: limit,
        include: ACTIVITY_INCLUDE,
      }),
      this.watchlist.getWatcherCount(market.id),
      // Buy/sell counts + distinct buyer/seller counts, same 24h window and the identical
      // count/groupBy pattern TraderService.getProfile already proved out for a trader's
      // own stats — just filtered by tokenMarketId instead of traderAddress.
      prisma.swap.count({ where: { tokenMarketId: market.id, side: 'buy', blockTimestamp: { gte: since } } }),
      prisma.swap.count({ where: { tokenMarketId: market.id, side: 'sell', blockTimestamp: { gte: since } } }),
      prisma.swap.groupBy({
        by: ['traderAddress'],
        where: { tokenMarketId: market.id, side: 'buy', traderAddress: { not: null }, blockTimestamp: { gte: since } },
      }),
      prisma.swap.groupBy({
        by: ['traderAddress'],
        where: { tokenMarketId: market.id, side: 'sell', traderAddress: { not: null }, blockTimestamp: { gte: since } },
      }),
    ]);

    const activeWallets =
      activeGrouped.length > 0
        ? await prisma.wallet.findMany({
            where: { address: { in: activeGrouped.map((g) => g.traderAddress!) } },
            include: { user: true },
          })
        : [];
    const walletByAddress = new Map(activeWallets.map((w) => [w.address, w]));

    const largeTradeLikeCounts = await batchLikeCounts(largeTradeRows.map((r) => r.id));

    return {
      uniqueTraders24h: market.uniqueTraders24h,
      recentTraders: recentRows.flatMap((row) =>
        row.traderAddress
          ? [
              {
                address: row.traderAddress,
                username: row.trader?.user?.username ?? null,
                avatarUrl: row.trader?.user?.avatarUrl ?? null,
                lastTradeAt: row.blockTimestamp.toISOString(),
                tradeCount24h: null,
              },
            ]
          : [],
      ),
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
      buyCount24h,
      sellCount24h,
      buyerCount24h: buyerGrouped.length,
      sellerCount24h: sellerGrouped.length,
    };
  }

  async getHistory(address: string, chainId: number, timeframe: Timeframe): Promise<Candle[]> {
    assertAddressShape(address);
    const market = await prisma.tokenMarket.findFirst({
      where: { chain: { identifier: requireChainIdentifier(chainId) }, token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      orderBy: { liquidityUsd: 'desc' },
    });
    if (!market) throw new NotFoundException(`No tracked market for token address "${address}"`);

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

    return rows.map((r) =>
      CandleSchema.parse({
        bucketStart: r.bucket_start.toISOString(),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volumeUsd: Number(r.volume_usd),
      }),
    );
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

    const summaries = [...evmRows.map((row) => toMarketSummary(row)), ...solanaRows.map((row) => toSolanaMarketSummary(row))];
    summaries.sort((a, b) => numDesc(a.liquidityUsd, b.liquidityUsd));
    // An exact-address search is someone asking for one specific token — never hide it.
    const isAddressLookup = EVM_ADDRESS_PATTERN.test(query.q) || SOLANA_MINT_PATTERN.test(query.q);
    return (isAddressLookup ? summaries : hideLookalikes(summaries)).slice(0, query.limit);
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
