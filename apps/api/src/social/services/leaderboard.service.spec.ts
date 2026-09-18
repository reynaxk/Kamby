import type { PinoLogger } from 'nestjs-pino';
import { prisma } from '@kamby/db';
import { LeaderboardService } from './leaderboard.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    realizedPnlEvent: { groupBy: jest.fn() },
    user: { findMany: jest.fn() },
    wallet: { findMany: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;
}

function fakeRedis() {
  return { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
}

describe('LeaderboardService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: LeaderboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    service = new LeaderboardService(redis as never, fakeLogger());
  });

  it('ranks by realized PnL, resolving identity and the most-recently-used verified wallet per user', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'user-1', _sum: { realizedPnlUsd: 500, costBasisUsd: 1000, proceedsUsd: 1500 } },
    ]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'user-1', username: 'alice', avatarUrl: 'a.png' },
    ]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
      { userId: 'user-1', address: '0xnewer' },
      { userId: 'user-1', address: '0xolder' },
    ]);

    const result = await service.getLeaderboard('24h', 25);

    expect(result).toEqual({
      window: '24h',
      entries: [
        {
          userId: 'user-1',
          username: 'alice',
          avatarUrl: 'a.png',
          walletAddress: '0xnewer', // the first (most-recently-used, per the query's own orderBy) row wins
          realizedPnlUsd: 500,
          realizedPnlPct: 50,
          volumeUsd: 2500,
        },
      ],
    });
    expect(mockedPrisma.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { lastUsedAt: 'desc' } }),
    );
  });

  it('returns an empty leaderboard, skipping the identity lookups entirely, when no PnL events matched the window', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    const result = await service.getLeaderboard('7d', 25);

    expect(result).toEqual({ window: '7d', entries: [] });
    expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('never fabricates a wallet address — skips a user with real PnL but no verified wallet on record', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'user-1', _sum: { realizedPnlUsd: 500, costBasisUsd: 1000, proceedsUsd: 1500 } },
    ]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1', username: 'alice', avatarUrl: null }]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getLeaderboard('24h', 25);

    expect(result.entries).toEqual([]);
  });

  it('reports a null realizedPnlPct (not 0) when zero cost basis backs the matched PnL', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'user-1', _sum: { realizedPnlUsd: 0, costBasisUsd: 0, proceedsUsd: 0 } },
    ]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1', username: null, avatarUrl: null }]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([{ userId: 'user-1', address: '0xa' }]);

    const result = await service.getLeaderboard('24h', 25);

    expect(result.entries[0]?.realizedPnlPct).toBeNull();
  });

  it('returns the cached value without touching the database on a cache hit', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ window: '24h', entries: [] }));

    const result = await service.getLeaderboard('24h', 25);

    expect(result).toEqual({ window: '24h', entries: [] });
    expect(mockedPrisma.realizedPnlEvent.groupBy).not.toHaveBeenCalled();
  });

  it('still computes correctly when Redis itself fails (read and write)', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await expect(service.getLeaderboard('24h', 25)).resolves.toEqual({ window: '24h', entries: [] });
  });
});
