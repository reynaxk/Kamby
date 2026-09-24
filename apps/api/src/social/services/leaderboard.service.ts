import { Inject, Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import {
  CHAIN_REGISTRY,
  DISCOVERY_CACHE_TTL_SECONDS,
  PNL_WINDOW_MS,
  type Leaderboard,
  type LeaderboardChainFilter,
  type LeaderboardEntry,
  type PnlWindow,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../../redis/redis.module';

/**
 * The public realized-PnL leaderboard — see docs/TRADER_INTELLIGENCE.md#realized-pnl. One
 * bounded, indexed (`@@index([userId, confirmedAt])`) GROUP BY over `realized_pnl_events`,
 * then two small batched lookups (User identity, most-recently-active verified wallet) —
 * never a query per entry. Redis cache-aside, same `DISCOVERY_CACHE_TTL_SECONDS`/pattern as
 * DiscoveryService#cached: Postgres stays authoritative, a cache miss or Redis outage just
 * means computing fresh rather than failing.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('LeaderboardService');
  }

  async getLeaderboard(window: PnlWindow, limit: number, chain: LeaderboardChainFilter | null = null): Promise<Leaderboard> {
    return this.cached(`leaderboard:${window}:${limit}:${chain ?? 'all'}`, async () => {
      const since = new Date(Date.now() - PNL_WINDOW_MS[window]);

      const grouped = await prisma.realizedPnlEvent.groupBy({
        by: ['userId'],
        where: { confirmedAt: { gte: since }, ...this.chainWhere(chain) },
        _sum: { realizedPnlUsd: true, costBasisUsd: true, proceedsUsd: true },
        orderBy: { _sum: { realizedPnlUsd: 'desc' } },
        take: limit,
      });
      if (grouped.length === 0) return { window, chain, entries: [] };

      const userIds = grouped.map((g) => g.userId);
      const [users, wallets] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, avatarUrl: true },
        }),
        // Most-recently-active verified wallet per user — picks which of a multi-wallet
        // user's several addresses to show, the same "one handle, several wallets" model
        // Wallet's own doc comment in packages/domain/src/wallet.ts describes. Ordered
        // desc so the first row seen per userId below is the right one to keep.
        prisma.wallet.findMany({
          where: { userId: { in: userIds }, verifiedAt: { not: null } },
          orderBy: { lastUsedAt: 'desc' },
          select: { userId: true, address: true },
        }),
      ]);

      const userById = new Map(users.map((u) => [u.id, u]));
      const walletByUserId = new Map<string, string>();
      for (const w of wallets) {
        if (!w.userId || walletByUserId.has(w.userId)) continue;
        walletByUserId.set(w.userId, w.address);
      }

      const entries: LeaderboardEntry[] = grouped.flatMap((g) => {
        // Every RealizedPnlEvent traces back to a Kamby trade, which always requires a
        // verified wallet to have placed — this should never actually be missing, but a
        // leaderboard entry with no real wallet to show is never fabricated, just skipped.
        const walletAddress = walletByUserId.get(g.userId);
        if (!walletAddress) return [];

        const user = userById.get(g.userId) ?? null;
        const realizedPnlUsd = g._sum.realizedPnlUsd === null ? 0 : Number(g._sum.realizedPnlUsd);
        const costBasisUsd = g._sum.costBasisUsd === null ? 0 : Number(g._sum.costBasisUsd);
        const proceedsUsd = g._sum.proceedsUsd === null ? 0 : Number(g._sum.proceedsUsd);

        return [
          {
            userId: g.userId,
            username: user?.username ?? null,
            avatarUrl: user?.avatarUrl ?? null,
            walletAddress,
            realizedPnlUsd,
            realizedPnlPct: costBasisUsd > 0 ? (realizedPnlUsd / costBasisUsd) * 100 : null,
            volumeUsd: costBasisUsd + proceedsUsd,
          },
        ];
      });

      return { window, chain, entries };
    });
  }

  /** Scopes the ranking to one chain — an EVM slug resolves through the event's linked
   *  `evmToken.chain` relation (an EVM `RealizedPnlEvent` always has one; see the model's own
   *  exactly-one-of-evmTokenId/solanaMint comment), `'solana'` just checks `solanaMint` is
   *  set. `null` (the default) applies no filter at all — one ranking across every chain. */
  private chainWhere(chain: LeaderboardChainFilter | null): Prisma.RealizedPnlEventWhereInput {
    if (chain === null) return {};
    if (chain === 'solana') return { solanaMint: { not: null } };
    return { evmToken: { chain: { identifier: CHAIN_REGISTRY[chain].identifier } } };
  }

  /** Cache-aside with an explicit TTL — identical shape to DiscoveryService#cached (see
   *  its own comment); duplicated rather than shared since the two services don't
   *  otherwise depend on each other and this is the only method that needs it here. */
  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Leaderboard cache read failed — computing fresh');
    }

    const value = await compute();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', DISCOVERY_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Leaderboard cache write failed — result still served, just not cached');
    }

    return value;
  }
}
