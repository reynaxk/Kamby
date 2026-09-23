import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { TraderService } from './trader.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn(), findMany: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
  },
}));
jest.mock('@kamby/domain', () => ({
  normalizeEvmAddress: (a: string) => a.toLowerCase(),
  PNL_WINDOW_MS: { '24h': 0, '7d': 0, '30d': 0 },
  MIN_TRADES_FOR_TRADER_RANKING: 5,
  toPnlWindowStats: jest.fn(),
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const ADDRESS = '0xabcdef1234567890abcdef1234567890abcdef12';

function fakeFollowRow(id: string, createdAt: Date) {
  return { id, userId: `user-${id}`, walletAddress: ADDRESS, createdAt };
}

describe('TraderService#getFollowers', () => {
  let service: TraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TraderService({} as never);
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
  });

  it('throws NotFoundException for a wallet that has never traded', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getFollowers(ADDRESS, undefined, 10)).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.follow.findMany).not.toHaveBeenCalled();
  });

  it('returns a null nextCursor and every row when there are fewer rows than the limit', async () => {
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([
      fakeFollowRow('1', new Date('2026-01-03')),
      fakeFollowRow('2', new Date('2026-01-02')),
    ]);

    const result = await service.getFollowers(ADDRESS, undefined, 10);

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('returns exactly `limit` items and a real nextCursor when there are more rows than the page size', async () => {
    // The service over-fetches by 1 (take: limit + 1) specifically to know whether a next
    // page exists without a separate count query — 3 rows back for a limit of 2 means "yes,
    // more exist," and the 3rd (unpaginated) row must never leak into the returned page.
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([
      fakeFollowRow('1', new Date('2026-01-03')),
      fakeFollowRow('2', new Date('2026-01-02')),
      fakeFollowRow('3', new Date('2026-01-01')),
    ]);

    const result = await service.getFollowers(ADDRESS, undefined, 2);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.userId)).toEqual(['user-1', 'user-2']);
    expect(result.nextCursor).not.toBeNull();
    expect(mockedPrisma.follow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }), // limit + 1
    );
  });

  it('a real nextCursor, decoded and reused, requests strictly older rows than where the previous page ended', async () => {
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValueOnce([
      fakeFollowRow('1', new Date('2026-01-03')),
      fakeFollowRow('2', new Date('2026-01-02')),
      fakeFollowRow('3', new Date('2026-01-01')),
    ]);
    const firstPage = await service.getFollowers(ADDRESS, undefined, 2);
    expect(firstPage.nextCursor).not.toBeNull();

    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValueOnce([fakeFollowRow('3', new Date('2026-01-01'))]);
    await service.getFollowers(ADDRESS, firstPage.nextCursor!, 2);

    expect(mockedPrisma.follow.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lt: new Date('2026-01-02') }, // strictly before the last item of page 1
        }),
      }),
    );
  });

  it('treats a malformed cursor as "start from the beginning," never a 500', async () => {
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([]);

    await service.getFollowers(ADDRESS, 'not-real-base64url-json', 10);

    expect(mockedPrisma.follow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletAddress: ADDRESS } }), // no createdAt filter added
    );
  });
});
