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
      chain: null,
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

    expect(result).toEqual({ window: '7d', chain: null, entries: [] });
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
    redis.get.mockResolvedValue(JSON.stringify({ window: '24h', chain: null, entries: [] }));

    const result = await service.getLeaderboard('24h', 25);

    expect(result).toEqual({ window: '24h', chain: null, entries: [] });
    expect(mockedPrisma.realizedPnlEvent.groupBy).not.toHaveBeenCalled();
  });

  it('still computes correctly when Redis itself fails (read and write)', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await expect(service.getLeaderboard('24h', 25)).resolves.toEqual({ window: '24h', chain: null, entries: [] });
  });

  it('caches the freshly computed result under the real window+limit+chain key on a cache miss', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await service.getLeaderboard('30d', 50);

    expect(redis.set).toHaveBeenCalledWith(
      'leaderboard:30d:50:all',
      JSON.stringify({ window: '30d', chain: null, entries: [] }),
      'EX',
      expect.any(Number),
    );
  });

  it('never reuses the cache entry for one window/limit pair on a different pair', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await service.getLeaderboard('24h', 25);
    await service.getLeaderboard('24h', 50);

    const keys = redis.set.mock.calls.map((call) => call[0]);
    expect(new Set(keys).size).toBe(2); // two distinct calls, two distinct cache keys
  });

  it('defaults a real null summed PnL (not just a zero one) to zero rather than crashing', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'user-1', _sum: { realizedPnlUsd: null, costBasisUsd: null, proceedsUsd: null } },
    ]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1', username: 'alice', avatarUrl: null }]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([{ userId: 'user-1', address: '0xa' }]);

    const result = await service.getLeaderboard('24h', 25);

    expect(result.entries[0]).toMatchObject({ realizedPnlUsd: 0, realizedPnlPct: null, volumeUsd: 0 });
  });

  it('preserves the real ranked order from the query across multiple entries, never re-sorting', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([
      { userId: 'user-1', _sum: { realizedPnlUsd: 900, costBasisUsd: 1000, proceedsUsd: 1900 } },
      { userId: 'user-2', _sum: { realizedPnlUsd: 100, costBasisUsd: 1000, proceedsUsd: 1100 } },
    ]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'user-1', username: 'alice', avatarUrl: null },
      { id: 'user-2', username: 'bob', avatarUrl: null },
    ]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
      { userId: 'user-1', address: '0xa' },
      { userId: 'user-2', address: '0xb' },
    ]);

    const result = await service.getLeaderboard('24h', 25);

    expect(result.entries.map((e) => e.userId)).toEqual(['user-1', 'user-2']);
  });

  it('applies no chain filter at all by default — one ranking across every chain', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await service.getLeaderboard('24h', 25);

    expect(mockedPrisma.realizedPnlEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { confirmedAt: { gte: expect.any(Date) } } }),
    );
  });

  it('scopes an EVM chain filter through the real evmToken.chain relation, by its identifier', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    const result = await service.getLeaderboard('24h', 25, 'bnb');

    expect(result.chain).toBe('bnb');
    expect(mockedPrisma.realizedPnlEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { confirmedAt: { gte: expect.any(Date) }, evmToken: { chain: { identifier: 'eip155:56' } } },
      }),
    );
  });

  it('scopes a "solana" filter to rows with a real solanaMint set, never joining through evmToken', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    const result = await service.getLeaderboard('24h', 25, 'solana');

    expect(result.chain).toBe('solana');
    expect(mockedPrisma.realizedPnlEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { confirmedAt: { gte: expect.any(Date) }, solanaMint: { not: null } } }),
    );
  });

  it('never reuses the cache entry for one chain filter on a different one, even with the same window/limit', async () => {
    (mockedPrisma.realizedPnlEvent.groupBy as jest.Mock).mockResolvedValue([]);

    await service.getLeaderboard('24h', 25, 'base');
    await service.getLeaderboard('24h', 25, 'bnb');
    await service.getLeaderboard('24h', 25, null);

    const keys = redis.set.mock.calls.map((call) => call[0]);
    expect(new Set(keys).size).toBe(3);
  });
});
