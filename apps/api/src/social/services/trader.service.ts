import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import {
  MIN_TRADES_FOR_TRADER_RANKING,
  normalizeTraderAddress,
  PNL_WINDOW_MS,
  toPnlWindowStats,
  type PnlWindow,
  type TopTrader,
  type TraderProfile,
  type TraderRealizedPnl,
  type TraderTokenStat,
  type KambyTrade,
} from '@kamby/domain';
import { toTopTrader, toTraderProfile, toTraderStats, toTraderSummary, toTraderTokenStat } from '../social.mapper';
import { FollowService } from './follow.service';

type SwapStats = [
  { _count: { _all: number }; _sum: { volumeUsd: Prisma.Decimal | null } },
  number,
  number,
  { blockTimestamp: Date } | null,
  { tokenMarketId: string; _sum: { volumeUsd: Prisma.Decimal | null } }[],
  { _max: { volumeUsd: Prisma.Decimal | null } },
  { _count: { _all: number }; _sum: { volumeUsd: Prisma.Decimal | null } },
];

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

const PNL_WINDOWS: PnlWindow[] = ['24h', '7d', '30d'];

/** How long a trader's swap aggregates are reused (2026-10-31: a whale's profile took 4s+, and
 *  lists open several profiles at once). Follow state is never cached. */
const SWAP_STATS_TTL_MS = 60_000;

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
  private readonly swapStatsCache = new Map<string, { at: number; value: Promise<SwapStats> }>();

  constructor(private readonly follows: FollowService) {}

  /** Every swap-table aggregate the profile needs, shared by concurrent callers and kept a minute. */
  private swapStats(normalized: string): Promise<SwapStats> {
    const hit = this.swapStatsCache.get(normalized);
    if (hit && Date.now() - hit.at < SWAP_STATS_TTL_MS) return hit.value;
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const value = Promise.all([
      prisma.swap.aggregate({ where: { traderAddress: normalized }, _count: { _all: true }, _sum: { volumeUsd: true } }),
      prisma.swap.count({ where: { traderAddress: normalized, side: 'buy' } }),
      prisma.swap.count({ where: { traderAddress: normalized, side: 'sell' } }),
      prisma.swap.findFirst({
        where: { traderAddress: normalized },
        orderBy: { blockTimestamp: 'desc' },
        select: { blockTimestamp: true },
      }),
      // Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-statistics. One GROUP BY for
      // uniqueTokensTraded + concentrationIndex, never a per-token query.
      prisma.swap.groupBy({ by: ['tokenMarketId'], where: { traderAddress: normalized }, _sum: { volumeUsd: true } }),
      prisma.swap.aggregate({ where: { traderAddress: normalized }, _max: { volumeUsd: true } }),
      prisma.swap.aggregate({
        where: { traderAddress: normalized, blockTimestamp: { gte: since24h } },
        _count: { _all: true },
        _sum: { volumeUsd: true },
      }),
    ]);
    // A failed lookup is dropped at once so the next request tries again.
    value.catch(() => this.swapStatsCache.delete(normalized));
    if (this.swapStatsCache.size > 500) this.swapStatsCache.clear();
    this.swapStatsCache.set(normalized, { at: Date.now(), value });
    return value;
  }

  async getProfile(address: string, viewerUserId: string | null): Promise<TraderProfile> {
    const normalized = normalizeTraderAddress(address);
    const wallet = await prisma.wallet.findUnique({ where: { address: normalized }, include: { user: true } });
    if (!wallet) throw new NotFoundException(`No tracked trader for wallet "${address}"`);

    const [[agg, buyCount, sellCount, lastSwap, perToken, largest, recent24h], followerCount, followingCount, isFollowedByMe, realizedPnl] =
      await Promise.all([
        this.swapStats(normalized),
        prisma.follow.count({ where: { walletAddress: normalized } }),
        // Only ever non-zero once this wallet has been verified (Wallet.userId set — see
        // docs/TRADING.md#wallet-ownership) and that account has made follows of its own.
        // `userId` is a non-nullable column, so Prisma's filter type (correctly) won't accept
        // `null` — short-circuit instead of querying when this wallet is unclaimed.
        wallet.userId ? prisma.follow.count({ where: { userId: wallet.userId } }) : Promise.resolve(0),
        this.follows.isFollowing(viewerUserId, normalized),
        // `realizedPnl` is `null` (the whole block, not zeroed stats) for a wallet with no
        // linked User — "no Kamby account" — see TraderRealizedPnlSchema's own comment.
        wallet.userId ? this.computeRealizedPnl(wallet.userId) : Promise.resolve(null),
      ]);

    // Trades placed through Kamby (2026-10-18: a real account showed "0 trades, $0 volume" next to
    // its own realized PnL — Kamby routes through aggregators, so most of its trades never land
    // in the indexed pools' Swap rows). Whichever record knows more trades is the one shown.
    const kamby = wallet.userId ? await this.kambyTradeTotals(wallet.userId) : null;
    const useKamby = kamby !== null && kamby.total > agg._count._all;
    const stats = toTraderStats(
      wallet,
      useKamby
        ? { totalSwaps: kamby.total, buyCount: kamby.buys, sellCount: kamby.sells, volumeUsd: new Prisma.Decimal(kamby.volumeUsd) }
        : { totalSwaps: agg._count._all, buyCount, sellCount, volumeUsd: agg._sum.volumeUsd },
      lastSwap?.blockTimestamp ?? null,
      {
        perTokenVolumeUsd: perToken.map((p) => (p._sum.volumeUsd === null ? 0 : Number(p._sum.volumeUsd))),
        largestTradeUsd: largest._max.volumeUsd,
        recent24h: { tradeCount: recent24h._count._all, volumeUsd: recent24h._sum.volumeUsd },
      },
    );

    return toTraderProfile(wallet, stats, followerCount, followingCount, isFollowedByMe, realizedPnl);
  }

  /** The trades this wallet's Kamby account placed, newest first: buys from its lots, sells from
   *  its realized-PnL events (one row per sell transaction). Empty for a wallet with no account. */
  async kambyTrades(address: string, limit: number): Promise<KambyTrade[]> {
    const wallet = await prisma.wallet.findUnique({ where: { address: normalizeTraderAddress(address) }, select: { userId: true } });
    if (!wallet?.userId) return [];
    const userId = wallet.userId;
    const [lots, events] = await Promise.all([
      prisma.tokenLot.findMany({ where: { userId }, orderBy: { acquiredAt: 'desc' }, take: limit, select: { evmTokenId: true, solanaMint: true, costBasisUsd: true, acquiredAt: true } }),
      prisma.realizedPnlEvent.findMany({
        where: { userId },
        orderBy: { confirmedAt: 'desc' },
        take: limit * 4,
        select: { evmTokenId: true, solanaMint: true, evmSellTransactionId: true, solanaSellTransactionId: true, proceedsUsd: true, realizedPnlUsd: true, confirmedAt: true },
      }),
    ]);
    type Sell = { evmTokenId: string | null; solanaMint: string | null; amountUsd: number; pnlUsd: number; at: Date };
    const sells = new Map<string, Sell>();
    for (const e of events) {
      const key = e.evmSellTransactionId ?? e.solanaSellTransactionId ?? `${e.confirmedAt.toISOString()}:${e.evmTokenId ?? e.solanaMint}`;
      const row = sells.get(key) ?? { evmTokenId: e.evmTokenId, solanaMint: e.solanaMint, amountUsd: 0, pnlUsd: 0, at: e.confirmedAt };
      row.amountUsd += Number(e.proceedsUsd);
      row.pnlUsd += Number(e.realizedPnlUsd);
      sells.set(key, row);
    }
    const evmIds = [...new Set([...lots.map((l) => l.evmTokenId), ...[...sells.values()].map((x) => x.evmTokenId)].filter((x): x is string => Boolean(x)))];
    const mints = [...new Set([...lots.map((l) => l.solanaMint), ...[...sells.values()].map((x) => x.solanaMint)].filter((x): x is string => Boolean(x)))];
    const [tokens, listed, pumps] = await Promise.all([
      evmIds.length ? prisma.token.findMany({ where: { id: { in: evmIds } }, select: { id: true, contractAddress: true, symbol: true, logoUrl: true, chain: { select: { identifier: true } } } }) : [],
      mints.length ? prisma.solanaTokenMarket.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true, logoUrl: true } }) : [],
      mints.length ? prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true } }) : [],
    ]);
    const meta = (evmTokenId: string | null, mint: string | null) => {
      if (evmTokenId) {
        const t = tokens.find((x) => x.id === evmTokenId);
        return t ? { chainIdentifier: t.chain.identifier, tokenAddress: t.contractAddress, symbol: t.symbol, logoUrl: t.logoUrl } : null;
      }
      if (!mint) return null;
      const l = listed.find((x) => x.mintAddress === mint);
      const p = pumps.find((x) => x.mintAddress === mint);
      return { chainIdentifier: 'solana', tokenAddress: mint, symbol: l?.symbol ?? p?.symbol ?? null, logoUrl: l?.logoUrl ?? null };
    };
    const rows: KambyTrade[] = [];
    for (const l of lots) {
      const m = meta(l.evmTokenId, l.solanaMint);
      if (m) rows.push({ side: 'BUY', ...m, amountUsd: Number(l.costBasisUsd), pnlUsd: null, at: l.acquiredAt.toISOString() });
    }
    for (const x of sells.values()) {
      const m = meta(x.evmTokenId, x.solanaMint);
      if (m) rows.push({ side: 'SELL', ...m, amountUsd: x.amountUsd, pnlUsd: x.pnlUsd, at: x.at.toISOString() });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }

  /** Confirmed Kamby trades (EVM + Solana) and their dollar volume: buys at cost, sells at proceeds. */
  private async kambyTradeTotals(userId: string): Promise<{ total: number; buys: number; sells: number; volumeUsd: number }> {
    const done = { userId, status: 'CONFIRMED' as const };
    const [evmBuys, evmSells, solBuys, solSells, bought, sold] = await Promise.all([
      prisma.tradeTransaction.count({ where: { ...done, side: 'BUY' } }),
      prisma.tradeTransaction.count({ where: { ...done, side: 'SELL' } }),
      prisma.solanaTradeTransaction.count({ where: { ...done, side: 'BUY' } }),
      prisma.solanaTradeTransaction.count({ where: { ...done, side: 'SELL' } }),
      prisma.tokenLot.aggregate({ where: { userId }, _sum: { costBasisUsd: true } }),
      prisma.realizedPnlEvent.aggregate({ where: { userId }, _sum: { proceedsUsd: true } }),
    ]);
    const buys = evmBuys + solBuys;
    const sells = evmSells + solSells;
    return { total: buys + sells, buys, sells, volumeUsd: Number(bought._sum.costBasisUsd ?? 0) + Number(sold._sum.proceedsUsd ?? 0) };
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
    const normalized = normalizeTraderAddress(address);
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
    const normalized = normalizeTraderAddress(address);
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
    const normalized = normalizeTraderAddress(address);
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
  /**
   * People search (2026-10-18): "@tati", "tat" or a wallet address. Names that start with what
   * you typed come first, then names containing it, then address matches; one row per person
   * (a user with three wallets is still one result). Addresses match without caring about case
   * — Solana addresses are mixed-case, so the old lowercased match never found them.
   */
  async search(query: string, limit: number): Promise<{ address: string; username: string | null; avatarUrl: string | null }[]> {
    const raw = query.trim().replace(/^@/, '');
    if (!raw) return [];
    const name = raw.toLowerCase();
    const looksLikeAddress = raw.length >= 6 && (/^0x[0-9a-f]+$/i.test(raw) || /^[1-9A-HJ-NP-Za-km-z]+$/.test(raw));
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [{ user: { username: { contains: name } } }, ...(looksLikeAddress ? [{ address: { contains: raw, mode: 'insensitive' as const } }] : [])],
      },
      take: limit * 4,
      orderBy: { firstSeenAt: 'asc' },
      include: { user: true },
    });
    const rank = (w: (typeof wallets)[number]) => {
      const u = w.user?.username ?? '';
      if (u === name) return 4;
      if (u.startsWith(name)) return 3;
      if (u.includes(name)) return 2;
      return 1;
    };
    const seen = new Set<string>();
    const out: typeof wallets = [];
    for (const w of [...wallets].sort((a, b) => rank(b) - rank(a))) {
      const who = w.userId ?? w.address;
      if (seen.has(who)) continue;
      seen.add(who);
      out.push(w);
      if (out.length >= limit) break;
    }
    return out.map(toTraderSummary);
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
