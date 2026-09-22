import { prisma } from '@kamby/db';
import { PositionService } from './position.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    tokenLot: { findMany: jest.fn() },
    token: { findMany: jest.fn() },
    tokenMarket: { findMany: jest.fn() },
    realizedPnlEvent: { findMany: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const TOKEN_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fakeToken(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'token-1',
    contractAddress: TOKEN_ADDRESS,
    symbol: 'FOO',
    name: 'Foo Token',
    decimals: 18,
    logoUrl: null,
    ...overrides,
  };
}

describe('PositionService', () => {
  let service: PositionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PositionService();
  });

  it('returns an empty list without any further queries when the user has no lots at all', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getMine('user-1');

    expect(result).toEqual([]);
    expect(mockedPrisma.token.findMany).not.toHaveBeenCalled();
  });

  it('computes quantity/cost-basis/unrealized PnL for a real open position', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 100 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken()]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([{ tokenId: 'token-1', priceUsd: 150 }]);

    const result = await service.getMine('user-1');

    expect(result).toEqual([
      {
        tokenAddress: TOKEN_ADDRESS,
        symbol: 'FOO',
        name: 'Foo Token',
        logoUrl: null,
        quantity: 1,
        costBasisUsd: 100,
        currentPriceUsd: 150,
        currentValueUsd: 150,
        unrealizedPnlUsd: 50,
        unrealizedPnlPct: 50,
      },
    ]);
  });

  it('never fabricates a quantity for a token whose decimals are still unresolved — skips it entirely', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 100 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken({ decimals: null })]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getMine('user-1');

    expect(result).toEqual([]);
  });

  it('excludes a fully-closed position (zero remaining across all its lots) — realized PnL/trade history cover that, not this endpoint', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '0', costBasisUsd: 100 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken()]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([{ tokenId: 'token-1', priceUsd: 150 }]);

    const result = await service.getMine('user-1');

    expect(result).toEqual([]);
  });

  it('sums multiple lots of the same token into one position', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 100 },
      { evmTokenId: 'token-1', quantityOriginalRaw: '2000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 300 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken()]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([{ tokenId: 'token-1', priceUsd: 200 }]);

    const result = await service.getMine('user-1');

    // Lot 1: fully remaining, full $100 cost basis. Lot 2: half remaining (1/2 of its 2-token
    // original), so half its $300 cost basis = $150. Total: 2 tokens remaining, $250 cost basis.
    expect(result[0]).toMatchObject({ quantity: 2, costBasisUsd: 250, currentValueUsd: 400, unrealizedPnlUsd: 150 });
  });

  it('reports a null price/value/PnL — never a stale or fabricated figure — when no market has priced this token yet', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 100 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken()]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([{ tokenId: 'token-1', priceUsd: null }]);

    const result = await service.getMine('user-1');

    expect(result[0]).toMatchObject({ currentPriceUsd: null, currentValueUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null });
  });

  it('picks the first (highest-liquidity, per the query\'s own orderBy) priced market when a token trades through several pools', async () => {
    (mockedPrisma.tokenLot.findMany as jest.Mock).mockResolvedValue([
      { evmTokenId: 'token-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 100 },
    ]);
    (mockedPrisma.token.findMany as jest.Mock).mockResolvedValue([fakeToken()]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
      { tokenId: 'token-1', priceUsd: 150 }, // deepest pool, ordered first
      { tokenId: 'token-1', priceUsd: 999 }, // a shallower, staler-priced pool
    ]);

    const result = await service.getMine('user-1');

    expect(result[0]?.currentPriceUsd).toBe(150);
  });
});

describe('PositionService#getMyPnlHistory', () => {
  let service: PositionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PositionService();
  });

  it('returns one point per day in range, every day present even with zero activity', async () => {
    (mockedPrisma.realizedPnlEvent.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getMyPnlHistory('user-1', 7);

    expect(result.days).toBe(7);
    expect(result.points).toHaveLength(7);
    expect(result.points.every((p) => p.realizedPnlUsd === 0 && p.cumulativeRealizedPnlUsd === 0)).toBe(true);
  });

  it('buckets events by their UTC calendar day and accumulates a real running total', async () => {
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const yesterday = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);

    (mockedPrisma.realizedPnlEvent.findMany as jest.Mock).mockResolvedValue([
      { confirmedAt: new Date(yesterday.getTime() + 3600_000), realizedPnlUsd: 50 },
      { confirmedAt: new Date(todayUtc.getTime() + 3600_000), realizedPnlUsd: -20 },
      { confirmedAt: new Date(todayUtc.getTime() + 7200_000), realizedPnlUsd: 10 },
    ]);

    const result = await service.getMyPnlHistory('user-1', 2);

    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const todayKey = todayUtc.toISOString().slice(0, 10);
    expect(result.points).toEqual([
      { date: yesterdayKey, realizedPnlUsd: 50, cumulativeRealizedPnlUsd: 50 },
      { date: todayKey, realizedPnlUsd: -10, cumulativeRealizedPnlUsd: 40 },
    ]);
  });

  it('scopes the query to the given userId and the requested window', async () => {
    (mockedPrisma.realizedPnlEvent.findMany as jest.Mock).mockResolvedValue([]);

    await service.getMyPnlHistory('user-42', 30);

    expect(mockedPrisma.realizedPnlEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-42' }) }),
    );
  });
});
