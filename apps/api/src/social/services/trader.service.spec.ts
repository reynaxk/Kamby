import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { TraderService } from './trader.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn(), findMany: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
    $queryRaw: jest.fn(),
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

function fakeWallet(address: string, username: string | null = null, avatarUrl: string | null = null) {
  return { address, user: username || avatarUrl ? { username, avatarUrl } : null };
}

describe('TraderService#search', () => {
  let service: TraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TraderService({} as never);
  });

  it('lowercases the real query before matching, since usernames are always stored lowercase', async () => {
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

    await service.search('AbC', 10);

    expect(mockedPrisma.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ address: { contains: 'abc' } }, { user: { username: { contains: 'abc' } } }],
        },
      }),
    );
  });

  it('maps each real matched wallet through toTraderSummary', async () => {
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([fakeWallet(ADDRESS, 'whale1', 'https://avatar.example/1.png')]);

    const result = await service.search('whale', 10);

    expect(result).toEqual([{ address: ADDRESS, username: 'whale1', avatarUrl: 'https://avatar.example/1.png' }]);
  });

  it('returns null username/avatarUrl for a wallet with no linked Kamby account, never a crash', async () => {
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([fakeWallet(ADDRESS)]);

    const result = await service.search('0xabc', 10);

    expect(result).toEqual([{ address: ADDRESS, username: null, avatarUrl: null }]);
  });

  it('passes the real limit straight through as the query bound', async () => {
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

    await service.search('abc', 7);

    expect(mockedPrisma.wallet.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
  });
});

describe('TraderService#getTopTraders', () => {
  let service: TraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TraderService({} as never);
  });

  it('returns an empty list and never queries wallets at all when nobody clears the ranking floor', async () => {
    (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    const result = await service.getTopTraders(10);

    expect(result).toEqual([]);
    expect(mockedPrisma.wallet.findMany).not.toHaveBeenCalled();
  });

  it('batches one wallet lookup for every ranked address rather than querying per row', async () => {
    (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
      { trader_address: '0xaaa', volume_usd: '5000', trade_count: 12n },
      { trader_address: '0xbbb', volume_usd: '3000', trade_count: 8n },
    ]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
      fakeWallet('0xaaa', 'whale1'),
      fakeWallet('0xbbb', 'whale2'),
    ]);

    const result = await service.getTopTraders(10);

    expect(mockedPrisma.wallet.findMany).toHaveBeenCalledTimes(1);
    expect(result.map((t) => t.username)).toEqual(['whale1', 'whale2']);
  });

  it('converts the real raw string volume and bigint trade count into plain numbers', async () => {
    (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([{ trader_address: '0xaaa', volume_usd: '12345.67', trade_count: 42n }]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([fakeWallet('0xaaa', 'whale1')]);

    const result = await service.getTopTraders(10);

    expect(result[0]).toEqual({ address: '0xaaa', username: 'whale1', avatarUrl: null, volumeUsd: 12345.67, tradeCount: 42 });
  });

  it('never crashes on a ranked trader with no matching wallet row, showing it with no real identity instead', async () => {
    (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([{ trader_address: '0xunlinked', volume_usd: '1000', trade_count: 6n }]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]); // no wallet row exists yet for this address

    const result = await service.getTopTraders(10);

    expect(result).toEqual([{ address: '0xunlinked', username: null, avatarUrl: null, volumeUsd: 1000, tradeCount: 6 }]);
  });

  it('preserves the real ranked order from the query rather than re-sorting', async () => {
    (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
      { trader_address: '0xfirst', volume_usd: '9000', trade_count: 20n },
      { trader_address: '0xsecond', volume_usd: '4000', trade_count: 10n },
    ]);
    (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([fakeWallet('0xfirst'), fakeWallet('0xsecond')]);

    const result = await service.getTopTraders(10);

    expect(result.map((t) => t.address)).toEqual(['0xfirst', '0xsecond']);
  });
});
