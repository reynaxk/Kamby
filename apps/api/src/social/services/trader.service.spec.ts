import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { TraderService } from './trader.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn(), findMany: jest.fn() },
    follow: { findMany: jest.fn(), count: jest.fn() },
    swap: { groupBy: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    tokenMarket: { findMany: jest.fn() },
    realizedPnlEvent: { aggregate: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('@kamby/domain', () => ({
  normalizeEvmAddress: (a: string) => a.toLowerCase(),
  PNL_WINDOW_MS: { '24h': 0, '7d': 0, '30d': 0 },
  MIN_TRADES_FOR_TRADER_RANKING: 5,
  toPnlWindowStats: jest.fn(),
  // getProfile's own real logic doesn't depend on these formulas' exact math (that's
  // toTraderStats'/these functions' own concern) — simple fixed fakes keep the mapper's real
  // (unmocked) assignment logic runnable without needing to model every input precisely.
  computeBuyRatio: jest.fn(() => 0.5),
  computeConcentrationIndex: jest.fn(() => 0.3),
  computeActivityFrequencyPerDay: jest.fn(() => 1.2),
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

function fakeFollowingRow(id: string, createdAt: Date, walletAddress: string, username: string | null = null) {
  return { id, userId: 'viewer', walletAddress, createdAt, wallet: fakeWallet(walletAddress, username) };
}

function fakeTokenMarketRow(id: string, address: string, symbol: string | null = 'FOO') {
  return { id, token: { contractAddress: address, symbol, name: 'Foo Token', logoUrl: null } };
}

describe('TraderService#getTraderTokens', () => {
  let service: TraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TraderService({} as never);
  });

  it('throws NotFoundException for a wallet that has never traded', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getTraderTokens(ADDRESS, 10)).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.swap.groupBy).not.toHaveBeenCalled();
  });

  it('returns an empty list without ever querying tokenMarket when this trader has no grouped activity', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([]);

    const result = await service.getTraderTokens(ADDRESS, 10);

    expect(result).toEqual([]);
    expect(mockedPrisma.tokenMarket.findMany).not.toHaveBeenCalled();
  });

  it('batches one tokenMarket lookup for every grouped token rather than querying per token', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([
      { tokenMarketId: 'm1', _count: { _all: 5 }, _sum: { volumeUsd: 1000 }, _max: { blockTimestamp: new Date('2026-01-01') } },
      { tokenMarketId: 'm2', _count: { _all: 3 }, _sum: { volumeUsd: 500 }, _max: { blockTimestamp: new Date('2026-01-02') } },
    ]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
      fakeTokenMarketRow('m1', '0xaaa', 'AAA'),
      fakeTokenMarketRow('m2', '0xbbb', 'BBB'),
    ]);

    const result = await service.getTraderTokens(ADDRESS, 10);

    expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledTimes(1);
    expect(result.map((t) => t.token.symbol)).toEqual(['AAA', 'BBB']);
    expect(result[0]).toEqual({
      token: { address: '0xaaa', symbol: 'AAA', name: 'Foo Token', logoUrl: null },
      tradeCount: 5,
      volumeUsd: 1000,
      lastActivityAt: new Date('2026-01-01').toISOString(),
    });
  });

  it('silently drops a grouped token whose market row is missing, rather than crashing the whole list', async () => {
    // A real, plausible gap: the group-by result references a tokenMarketId the batched
    // lookup didn't return (e.g. deleted between the two queries) — flatMap([]) means it's
    // dropped, not that the response 500s.
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([
      { tokenMarketId: 'missing', _count: { _all: 1 }, _sum: { volumeUsd: 100 }, _max: { blockTimestamp: new Date() } },
      { tokenMarketId: 'm1', _count: { _all: 5 }, _sum: { volumeUsd: 1000 }, _max: { blockTimestamp: new Date('2026-01-01') } },
    ]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeTokenMarketRow('m1', '0xaaa')]);

    const result = await service.getTraderTokens(ADDRESS, 10);

    expect(result).toHaveLength(1);
    expect(result[0]!.token.address).toBe('0xaaa');
  });

  it('defaults a null summed volume to zero rather than crashing', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([
      { tokenMarketId: 'm1', _count: { _all: 1 }, _sum: { volumeUsd: null }, _max: { blockTimestamp: new Date('2026-01-01') } },
    ]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeTokenMarketRow('m1', '0xaaa')]);

    const result = await service.getTraderTokens(ADDRESS, 10);

    expect(result[0]!.volumeUsd).toBe(0);
  });

  it('passes the real limit through as the group-by page size', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: ADDRESS });
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([]);

    await service.getTraderTokens(ADDRESS, 7);

    expect(mockedPrisma.swap.groupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
  });
});

describe('TraderService#getFollowing', () => {
  let service: TraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TraderService({} as never);
  });

  it('throws NotFoundException for a wallet that has never traded', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getFollowing(ADDRESS, undefined, 10)).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.follow.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page without ever querying follows for an unclaimed wallet (no linked userId)', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: null });

    const result = await service.getFollowing(ADDRESS, undefined, 10);

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(mockedPrisma.follow.findMany).not.toHaveBeenCalled();
  });

  it('returns a null nextCursor and every row when there are fewer rows than the limit', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: 'viewer' });
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([
      fakeFollowingRow('1', new Date('2026-01-03'), '0xaaa', 'whale1'),
      fakeFollowingRow('2', new Date('2026-01-02'), '0xbbb', 'whale2'),
    ]);

    const result = await service.getFollowing(ADDRESS, undefined, 10);

    expect(result.items).toEqual([
      { address: '0xaaa', username: 'whale1', avatarUrl: null },
      { address: '0xbbb', username: 'whale2', avatarUrl: null },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it('returns exactly `limit` items and a real nextCursor when there are more rows than the page size', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: 'viewer' });
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([
      fakeFollowingRow('1', new Date('2026-01-03'), '0xaaa'),
      fakeFollowingRow('2', new Date('2026-01-02'), '0xbbb'),
      fakeFollowingRow('3', new Date('2026-01-01'), '0xccc'),
    ]);

    const result = await service.getFollowing(ADDRESS, undefined, 2);

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
    expect(mockedPrisma.follow.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 })); // limit + 1
  });

  it('treats a malformed cursor as "start from the beginning," never a 500', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: 'viewer' });
    (mockedPrisma.follow.findMany as jest.Mock).mockResolvedValue([]);

    await service.getFollowing(ADDRESS, 'not-real-base64url-json', 10);

    expect(mockedPrisma.follow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'viewer' } }), // no createdAt filter added
    );
  });
});

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

function fakeProfileWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return { address: ADDRESS, userId: null, firstSeenAt: new Date('2026-01-01'), user: null, ...overrides };
}

// One shape satisfies all 3 real prisma.swap.aggregate call sites in getProfile (agg,
// largest, recent24h) at once — each only reads the specific keys it needs, so this avoids
// having to track which of the 3 concurrent Promise.all calls resolves in which order.
const GENERIC_SWAP_AGGREGATE = { _count: { _all: 5 }, _sum: { volumeUsd: 1000 }, _max: { volumeUsd: 500 } };

describe('TraderService#getProfile', () => {
  let service: TraderService;
  let isFollowing: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    isFollowing = jest.fn().mockResolvedValue(false);
    service = new TraderService({ isFollowing } as never);
    (mockedPrisma.swap.aggregate as jest.Mock).mockResolvedValue(GENERIC_SWAP_AGGREGATE);
    (mockedPrisma.swap.count as jest.Mock).mockResolvedValue(0);
    (mockedPrisma.swap.findFirst as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.follow.count as jest.Mock).mockResolvedValue(0);
    (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.realizedPnlEvent.aggregate as jest.Mock).mockResolvedValue({
      _sum: { realizedPnlUsd: 0, costBasisUsd: 0, proceedsUsd: 0 },
      _count: { _all: 0 },
    });
  });

  it('throws NotFoundException for a wallet with no tracked activity, never running any aggregate query', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getProfile(ADDRESS, null)).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.swap.aggregate).not.toHaveBeenCalled();
  });

  it('never queries a "following" count and reports realizedPnl as null for an unclaimed wallet (no linked Kamby account)', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeProfileWallet({ userId: null }));

    const profile = await service.getProfile(ADDRESS, null);

    expect(mockedPrisma.follow.count).toHaveBeenCalledTimes(1); // only followerCount, never followingCount
    expect(mockedPrisma.realizedPnlEvent.aggregate).not.toHaveBeenCalled();
    expect(profile.realizedPnl).toBeNull();
  });

  it('queries a real "following" count and computes real realizedPnl for a claimed wallet', async () => {
    const { toPnlWindowStats } = jest.requireMock('@kamby/domain') as { toPnlWindowStats: jest.Mock };
    toPnlWindowStats.mockReturnValue({ realizedPnlUsd: 100, costBasisUsd: 500, proceedsUsd: 600, realizedPnlPct: 20, matchedTradeCount: 3 });
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeProfileWallet({ userId: 'user-1' }));

    const profile = await service.getProfile(ADDRESS, null);

    expect(mockedPrisma.follow.count).toHaveBeenCalledTimes(2); // followerCount AND followingCount
    expect(mockedPrisma.follow.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(mockedPrisma.realizedPnlEvent.aggregate).toHaveBeenCalledTimes(3); // one per PnL window
    expect(profile.realizedPnl).not.toBeNull();
    expect(profile.realizedPnl?.['24h']).toEqual({
      realizedPnlUsd: 100,
      costBasisUsd: 500,
      proceedsUsd: 600,
      realizedPnlPct: 20,
      matchedTradeCount: 3,
    });
  });

  it('reports the real viewer-specific follow state from FollowService, never assumed', async () => {
    isFollowing.mockResolvedValue(true);
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeProfileWallet());

    const profile = await service.getProfile(ADDRESS, 'viewer-1');

    expect(isFollowing).toHaveBeenCalledWith('viewer-1', ADDRESS);
    expect(profile.isFollowedByMe).toBe(true);
  });

  it('wires the real follower count through from the database, not a placeholder', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeProfileWallet());
    (mockedPrisma.follow.count as jest.Mock).mockResolvedValue(42);

    const profile = await service.getProfile(ADDRESS, null);

    expect(profile.followerCount).toBe(42);
  });
});
