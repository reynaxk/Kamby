import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { ActivityService } from './activity.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    follow: { findMany: jest.fn() },
    wallet: { findUnique: jest.fn() },
    swap: { findMany: jest.fn() },
    activityLike: { groupBy: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('@kamby/domain', () => ({
  DISCOVERY_RANKING: { minLiquidityUsd: 10_000 },
  normalizeEvmAddress: (a: string) => a.toLowerCase(),
  decodeActivityCursor: jest.fn((raw: string) => (raw === 'bad' ? null : JSON.parse(raw))),
  encodeActivityCursor: jest.fn((c: unknown) => JSON.stringify(c)),
}));
jest.mock('../social.mapper', () => ({
  toSocialActivity: (row: { id: string }, likeCount: number, likedByMe: boolean | null) => ({
    id: row.id,
    social: { likes: likeCount, likedByMe },
  }),
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function fakeSwap(id: string, blockTimestamp: Date) {
  return { id, blockTimestamp, tokenMarket: {}, trader: null };
}

describe('ActivityService', () => {
  let service: ActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ActivityService();
    (mockedPrisma.swap.findMany as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.activityLike.groupBy as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.activityLike.findMany as jest.Mock).mockResolvedValue([]);
  });

  describe('getGlobalFeed', () => {
    it('applies the quality gate (liquidityUsd floor) when no tokenAddress is given, deliberately cross-chain', async () => {
      await service.getGlobalFeed({ limit: 10, chainId: 8453, viewerUserId: null });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ tokenMarket: { liquidityUsd: { gte: 10_000 } } }, {}] },
        }),
      );
    });

    it('scopes to exactly one token on one chain, case-insensitively, when a tokenAddress is given', async () => {
      await service.getGlobalFeed({ limit: 10, chainId: 8453, tokenAddress: '0xABC', viewerUserId: null });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { tokenMarket: { chainId: 8453, token: { contractAddress: { equals: '0xabc', mode: 'insensitive' } } } },
              {},
            ],
          },
        }),
      );
    });
  });

  describe('getFollowingFeed', () => {
    it('returns an empty page (not an error) and never queries swaps when the user follows no one', async () => {
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getFollowingFeed({ userId: 'user-1', limit: 10 });

      expect(result).toEqual({ items: [], nextCursor: null });
      expect(mockedPrisma.swap.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to exactly the followed wallets when the user follows at least one', async () => {
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([{ walletAddress: '0xaaa' }, { walletAddress: '0xbbb' }]);

      await service.getFollowingFeed({ userId: 'user-1', limit: 10 });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ traderAddress: { in: ['0xaaa', '0xbbb'] } }, {}] },
        }),
      );
    });
  });

  describe('getTraderActivity', () => {
    it('throws NotFoundException for an address our indexer has never observed trading', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getTraderActivity({ address: '0xabc', limit: 10, viewerUserId: null })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockedPrisma.swap.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPersonalizedFeedCandidates', () => {
    it('falls back to the general quality-gated feed alone when the user follows no one', async () => {
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([]);

      await service.getPersonalizedFeedCandidates({ userId: 'user-1', limit: 10 });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ tokenMarket: { liquidityUsd: { gte: 10_000 } } }, {}] },
        }),
      );
    });

    it('unions followed-trader activity with the general feed rather than replacing it, when follows exist', async () => {
      (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([{ walletAddress: '0xaaa' }]);

      await service.getPersonalizedFeedCandidates({ userId: 'user-1', limit: 10 });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ OR: [{ traderAddress: { in: ['0xaaa'] } }, { tokenMarket: { liquidityUsd: { gte: 10_000 } } }] }, {}],
          },
        }),
      );
    });
  });

  describe('cursor pagination (fetchPage, exercised via getTraderActivity)', () => {
    beforeEach(() => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: '0xabc' });
    });

    it('builds a real "strictly older, with an id tiebreak on an exact timestamp match" cursor condition', async () => {
      const cursor = JSON.stringify({ blockTimestamp: '2026-01-02T00:00:00.000Z', id: 'swap-5' });

      await service.getTraderActivity({ address: '0xabc', cursor, limit: 10, viewerUserId: null });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { traderAddress: '0xabc' },
              {
                OR: [
                  { blockTimestamp: { lt: new Date('2026-01-02T00:00:00.000Z') } },
                  { blockTimestamp: new Date('2026-01-02T00:00:00.000Z'), id: { lt: 'swap-5' } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('treats a malformed cursor as "start from the newest," never a 400/500', async () => {
      await service.getTraderActivity({ address: '0xabc', cursor: 'bad', limit: 10, viewerUserId: null });

      expect(mockedPrisma.swap.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ traderAddress: '0xabc' }, {}] } }),
      );
    });

    it('never leaks the limit+1 lookahead row into the returned page, and encodes a real nextCursor', async () => {
      (mockedPrisma.swap.findMany as jest.Mock).mockResolvedValue([
        fakeSwap('1', new Date('2026-01-03')),
        fakeSwap('2', new Date('2026-01-02')),
      ]);

      const result = await service.getTraderActivity({ address: '0xabc', limit: 1, viewerUserId: null });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('1');
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('like state (batchLikeState, exercised via getTraderActivity)', () => {
    beforeEach(() => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: '0xabc' });
      (mockedPrisma.swap.findMany as jest.Mock).mockResolvedValue([fakeSwap('1', new Date())]);
    });

    it('marks likedByMe as null (not a fabricated false) for every item when there is no viewer', async () => {
      const result = await service.getTraderActivity({ address: '0xabc', limit: 10, viewerUserId: null });

      expect(result.items[0]?.social.likedByMe).toBeNull();
      expect(mockedPrisma.activityLike.findMany).not.toHaveBeenCalled();
    });

    it('marks likedByMe as a real true/false, and includes the real like count, for a known viewer', async () => {
      (mockedPrisma.activityLike.groupBy as jest.Mock).mockResolvedValue([{ swapId: '1', _count: { _all: 3 } }]);
      (mockedPrisma.activityLike.findMany as jest.Mock).mockResolvedValue([{ swapId: '1' }]);

      const result = await service.getTraderActivity({ address: '0xabc', limit: 10, viewerUserId: 'user-1' });

      expect(result.items[0]?.social.likes).toBe(3);
      expect(result.items[0]?.social.likedByMe).toBe(true);
    });
  });
});
