import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
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
import { toMarketSummary, type MarketRow } from './market.mapper';
import { WatchlistService } from './watchlist.service';

const MARKET_INCLUDE = { token: true, quoteToken: true, chain: true } as const;
const ACTIVITY_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true, chain: true } },
  trader: { include: { user: true } },
} as const;
/** How many recent trades a token page's "active traders" section considers — kept small
 *  and time-boxed (24h) so this is always a cheap, bounded query, never a full-history scan. */
const TOKEN_TRADER_LOOKBACK_HOURS = 24;

/** bucket width and lookback window per chart timeframe — see docs/MARKET_DATA.md#timeframes. */
const TIMEFRAME_CONFIG: Record<Timeframe, { bucket: string; lookback: string }> = {
  '1H': { bucket: '5 minutes', lookback: '1 hour' },
  '4H': { bucket: '15 minutes', lookback: '4 hours' },
  '1D': { bucket: '1 hour', lookback: '1 day' },
  '1W': { bucket: '4 hours', lookback: '7 days' },
  '1M': { bucket: '1 day', lookback: '30 days' },
};

@Injectable()
export class MarketService {
  constructor(
    private readonly watchlist: WatchlistService,
    private readonly config: ConfigService<Env, true>,
  ) {}

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
   */
  async discover(query: DiscoverQueryDto): Promise<MarketSummary[]> {
    const rows = await prisma.tokenMarket.findMany({ include: MARKET_INCLUDE });
    const filtered = query.search ? rows.filter((row) => matchesSearch(row, query.search!)) : rows;

    const scored = filtered
      .map((row) => ({
        row,
        score: computeDiscoveryScore({
          volume24hUsd: row.volume24hUsd === null ? null : Number(row.volume24hUsd),
          liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
          priceChange24hPct: row.priceChange24hPct === null ? null : Number(row.priceChange24hPct),
          lastPriceUpdateAt: row.lastPriceUpdateAt,
        }),
      }))
      .filter((entry): entry is { row: MarketRow; score: number } => entry.score !== null);

    scored.sort((a, b) => compareBySort(a, b, query.sort));

    return scored.slice(0, query.limit).map(({ row, score }) => toMarketSummary(row, score));
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
    const rows = await prisma.$queryRaw<
      {
        bucket_start: Date;
        open: unknown;
        high: unknown;
        low: unknown;
        close: unknown;
        volume_usd: unknown;
      }[]
    >`
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
   *  reasoning as `discover()` below. */
  async search(query: SearchQueryDto): Promise<MarketSummary[]> {
    const rows = await prisma.tokenMarket.findMany({
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
    });
    return rows.map((row) => toMarketSummary(row));
  }
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

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

function compareBySort(
  a: { row: MarketRow; score: number },
  b: { row: MarketRow; score: number },
  sort: DiscoverQueryDto['sort'],
): number {
  switch (sort) {
    case 'volume':
      return numDesc(a.row.volume24hUsd, b.row.volume24hUsd);
    case 'liquidity':
      return numDesc(a.row.liquidityUsd, b.row.liquidityUsd);
    case 'priceChange':
      return numDesc(a.row.priceChange24hPct, b.row.priceChange24hPct);
    case 'score':
    default:
      return b.score - a.score;
  }
}

function numDesc(a: { toNumber(): number } | null, b: { toNumber(): number } | null): number {
  const an = a === null ? -Infinity : a.toNumber();
  const bn = b === null ? -Infinity : b.toNumber();
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
