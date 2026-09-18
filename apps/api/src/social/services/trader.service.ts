import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import {
  MIN_TRADES_FOR_TRADER_RANKING,
  normalizeEvmAddress,
  PNL_WINDOW_MS,
  toPnlWindowStats,
  type PnlWindow,
  type TopTrader,
  type TraderProfile,
  type TraderRealizedPnl,
  type TraderTokenStat,
} from '@kamby/domain';
import { toTopTrader, toTraderProfile, toTraderStats, toTraderSummary, toTraderTokenStat } from '../social.mapper';
import { FollowService } from './follow.service';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

const PNL_WINDOWS: PnlWindow[] = ['24h', '7d', '30d'];

/**
 * Trader identity: profiles, stats computed from indexed swaps, and follower/following
 * lists. See docs/SOCIAL.md#trader-identity. `TraderStats` itself still never computes
 * profit/ROI/win rate — it's derived from all-chain swap activity, which Kamby doesn't
 * have cost-basis data for (see TraderStats' own doc comment in wallet.ts). The separate
 * `realizedPnl` block below *is* real profit/loss, deliberately scoped to Kamby-originated
 * trades only — see docs/TRADER_INTELLIGENCE.md#realized-pnl.
 */
@Injectable()
export class TraderService {
  constructor(private readonly follows: FollowService) {}

  async getProfile(address: string, viewerUserId: string | null): Promise<TraderProfile> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, include: { user: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const since24h = new Date(Date.now() - 24 * 60 * 60_000);

    const [agg, buyCount, sellCount, lastSwap, followerCount, followingCount, isFollowedByMe, perToken, largest, recent24h, realizedPnl] =
      await Promise.all([
        prisma.swap.aggregate({ where: { traderAddress: normalized }, _count: { _all: true }, _sum: { volumeUsd: true } }),
        prisma.swap.count({ where: { traderAddress: normalized, side: 'buy' } }),
        prisma.swap.count({ where: { traderAddress: normalized, side: 'sell' } }),
        prisma.swap.findFirst({
          where: { traderAddress: normalized },
          orderBy: { blockTimestamp: 'desc' },
          select: { blockTimestamp: true },
        }),
        prisma.follow.count({ where: { walletAddress: normalized } }),
        // Only ever non-zero once this wallet has been verified (Wallet.userId set — see
        // docs/TRADING.md#wallet-ownership) and that account has made follows of its own.
        // `userId` is a non-nullable column, so Prisma's filter type (correctly) won't accept
        // `null` — short-circuit instead of querying when this wallet is unclaimed.
        wallet.userId ? prisma.follow.count({ where: { userId: wallet.userId } }) : Promise.resolve(0),
        this.follows.isFollowing(viewerUserId, normalized),
        // Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-statistics. One GROUP BY for
        // uniqueTokensTraded + concentrationIndex, never a per-token query.
        prisma.swap.groupBy({ by: ['tokenMarketId'], where: { traderAddress: normalized }, _sum: { volumeUsd: true } }),
        prisma.swap.aggregate({ where: { traderAddress: normalized }, _max: { volumeUsd: true } }),
        prisma.swap.aggregate({
          where: { traderAddress: normalized, blockTimestamp: { gte: since24h } },
          _count: { _all: true },
          _sum: { volumeUsd: true },
        }),
        // `realizedPnl` is `null` (the whole block, not zeroed stats) for a wallet with no
        // linked User — "no Kamby account" — see TraderRealizedPnlSchema's own comment.
        wallet.userId ? this.computeRealizedPnl(wallet.userId) : Promise.resolve(null),
      ]);

    const stats = toTraderStats(
      wallet,
      { totalSwaps: agg._count._all, buyCount, sellCount, volumeUsd: agg._sum.volumeUsd },
      lastSwap?.blockTimestamp ?? null,
      {
        perTokenVolumeUsd: perToken.map((p) => (p._sum.volumeUsd === null ? 0 : Number(p._sum.volumeUsd))),
        largestTradeUsd: largest._max.volumeUsd,
        recent24h: { tradeCount: recent24h._count._all, volumeUsd: recent24h._sum.volumeUsd },
      },
    );

    return toTraderProfile(wallet, stats, followerCount, followingCount, isFollowedByMe, realizedPnl);
  }

  /**
   * The three rolling-window realized-PnL aggregates for one Kamby account — see
   * docs/TRADER_INTELLIGENCE.md#realized-pnl. Three separate bounded, indexed
   * (`@@index([userId, confirmedAt])`) aggregate queries rather than one fetch-and-bucket
   * pass in JS, matching how `recent24h` above is its own query rather than derived from
   * `agg` — Postgres does the summing, this layer only shapes the result.
   */
  private async computeRealizedPnl(userId: string): Promise<TraderRealizedPnl> {
    const aggregates = await Promise.all(
      PNL_WINDOWS.map((window) =>
        prisma.realizedPnlEvent.aggregate({
          where: { userId, confirmedAt: { gte: new Date(Date.now() - PNL_WINDOW_MS[window]) } },
          _sum: { realizedPnlUsd: true, costBasisUsd: true, proceedsUsd: true },
          _count: { _all: true },
        }),
      ),
    );

    const [stats24h, stats7d, stats30d] = PNL_WINDOWS.map((window, i) => {
      const agg = aggregates[i]!;
      return toPnlWindowStats(window, {
        realizedPnlUsd: agg._sum.realizedPnlUsd === null ? 0 : Number(agg._sum.realizedPnlUsd),
        costBasisUsd: agg._sum.costBasisUsd === null ? 0 : Number(agg._sum.costBasisUsd),
        proceedsUsd: agg._sum.proceedsUsd === null ? 0 : Number(agg._sum.proceedsUsd),
        matchedCount: agg._count._all,
      });
    });

    return { '24h': stats24h!, '7d': stats7d!, '30d': stats30d! };
  }

  /**
   * The tokens this trader has traded, aggregated — see docs/TRADER_INTELLIGENCE.md#trader-to-token.
   * One GROUP BY bounded by `limit`, then one batched TokenMarket lookup for the returned
   * ids — never a query per token. Ordered by volume (this trader's most significant
   * tokens first), matching getTopTraders' own "rank by real measured activity" convention.
   */
  async getTraderTokens(address: string, limit: number): Promise<TraderTokenStat[]> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, select: { address: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const grouped = await prisma.swap.groupBy({
      by: ['tokenMarketId'],
      where: { traderAddress: normalized },
      _count: { _all: true },
      _sum: { volumeUsd: true },
      _max: { blockTimestamp: true },
      orderBy: { _sum: { volumeUsd: 'desc' } },
      take: limit,
    });
    if (grouped.length === 0) return [];

    const markets = await prisma.tokenMarket.findMany({
      where: { id: { in: grouped.map((g) => g.tokenMarketId) } },
      include: { token: true },
    });
    const marketById = new Map(markets.map((m) => [m.id, m]));

    return grouped.flatMap((g) => {
      const market = marketById.get(g.tokenMarketId);
      if (!market || !g._max.blockTimestamp) return [];
      return [toTraderTokenStat(market, g._count._all, g._sum.volumeUsd ?? 0, g._max.blockTimestamp)];
    });
  }

  /** Users following this trader. Items are deliberately minimal (`userId` + when) — Phase
   *  2's anonymous sessions have no public display identity to show yet; see
   *  docs/SOCIAL.md#authentication for why, and the follow-count on the profile for the
   *  number most UI needs. */
  async getFollowers(address: string, rawCursor: string | undefined, limit: number): Promise<CursorPage<{ userId: string; followedAt: string }>> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, select: { address: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const cursor = rawCursor ? decodeFollowCursor(rawCursor) : null;
    const rows = await prisma.follow.findMany({
      where: {
        walletAddress: normalized,
        ...(cursor ? { createdAt: { lt: new Date(cursor.createdAt) }, } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeFollowCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map((f) => ({ userId: f.userId, followedAt: f.createdAt.toISOString() })), nextCursor };
  }

  /** Wallets this trader's linked User account follows. Empty until this wallet has been
   *  verified (see docs/TRADING.md#wallet-ownership) and that account has followed
   *  someone — implemented for real from Phase 2 onward so it needed no contract change
   *  once linking shipped. */
  async getFollowing(
    address: string,
    rawCursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<{ address: string; username: string | null; avatarUrl: string | null }>> {
    const normalized = normalizeEvmAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, select: { userId: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    // `userId` is non-nullable on Follow, so there's nothing to list at all for an
    // unclaimed wallet — skip the query rather than pass `null` to a filter that can't
    // accept it.
    if (!wallet.userId) return { items: [], nextCursor: null };

    const cursor = rawCursor ? decodeFollowCursor(rawCursor) : null;
    const rows = await prisma.follow.findMany({
      where: {
        userId: wallet.userId,
        ...(cursor ? { createdAt: { lt: new Date(cursor.createdAt) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { wallet: { include: { user: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeFollowCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map((f) => toTraderSummary(f.wallet)), nextCursor };
  }

  /**
   * Ranked by real, measured 24h trading volume among wallets clearing the minimum
   * trade-count floor — "Most Active" / "Highest Volume," never "smart money" or
   * "profitable" (Kamby has no cost-basis data to back that claim). See
   * docs/SOCIAL.md#trader-discovery.
   */
  async getTopTraders(limit: number): Promise<TopTrader[]> {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const rows = await prisma.$queryRaw<{ trader_address: string; volume_usd: string; trade_count: bigint }[]>`
      SELECT trader_address, SUM(volume_usd) AS volume_usd, COUNT(*) AS trade_count
      FROM swaps
      WHERE trader_address IS NOT NULL AND block_timestamp >= ${since24h}
      GROUP BY trader_address
      HAVING COUNT(*) >= ${MIN_TRADES_FOR_TRADER_RANKING}
      ORDER BY SUM(volume_usd) DESC
      LIMIT ${limit}
    `;
    if (rows.length === 0) return [];

    const wallets = await prisma.wallet.findMany({
      where: { address: { in: rows.map((r) => r.trader_address) } },
      include: { user: true },
    });
    const walletByAddress = new Map(wallets.map((w) => [w.address, w]));

    return rows.map((r) =>
      toTopTrader(r.trader_address, walletByAddress.get(r.trader_address), Number(r.volume_usd), Number(r.trade_count)),
    );
  }

  /** Address-prefix or username search — server-backed, indexed, bounded. See
   *  docs/SOCIAL.md#search. Usernames are always stored lowercase (see normalizeUsername
   *  in wallet.ts), so a plain `contains` against the lowercased query is correct — no
   *  `mode: 'insensitive'` needed on that side. */
  async search(query: string, limit: number): Promise<{ address: string; username: string | null; avatarUrl: string | null }[]> {
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { address: { contains: query.toLowerCase() } },
          { user: { username: { contains: query.toLowerCase() } } },
        ],
      },
      take: limit,
      orderBy: { firstSeenAt: 'desc' },
      include: { user: true },
    });
    return wallets.map(toTraderSummary);
  }
}

interface FollowCursor {
  createdAt: string;
  id: string;
}

function encodeFollowCursor(cursor: FollowCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeFollowCursor(raw: string): FollowCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FollowCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
