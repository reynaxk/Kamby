import { computeTrendingScore } from '@kamby/domain';
import { prisma } from '@kamby/db';
import { toMarketSummary } from '../../market/market.mapper';
import { TrendingService } from './trending.service';

jest.mock('@kamby/db', () => ({ prisma: { tokenMarket: { findMany: jest.fn() } } }));
jest.mock('@kamby/domain', () => ({ computeTrendingScore: jest.fn() }));
jest.mock('../../market/market.mapper', () => ({ toMarketSummary: jest.fn() }));

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const mockedScore = jest.mocked(computeTrendingScore);
const mockedToMarketSummary = jest.mocked(toMarketSummary);

function fakeRow(id: string) {
  return { id, tokenId: `token-${id}`, volume24hUsd: null, liquidityUsd: null, uniqueTraders24h: 0, tradeCount24h: 0 };
}

describe('TrendingService', () => {
  let service: TrendingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrendingService();
    mockedToMarketSummary.mockImplementation(
      ((row: { id: string }) => ({ tokenAddress: row.id })) as unknown as typeof toMarketSummary,
    );
  });

  it('excludes any market computeTrendingScore gates out (null score), never a fabricated 0', async () => {
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeRow('a'), fakeRow('b')]);
    mockedScore.mockReturnValueOnce(5).mockReturnValueOnce(null);

    const result = await service.getTrending(10);

    expect(result).toHaveLength(1);
    expect(result[0]?.trendingScore).toBe(5);
  });

  it('sorts descending by score — highest trending first, not insertion order', async () => {
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeRow('low'), fakeRow('high'), fakeRow('mid')]);
    mockedScore.mockReturnValueOnce(2).mockReturnValueOnce(9).mockReturnValueOnce(5);

    const result = await service.getTrending(10);

    expect(result.map((r) => r.trendingScore)).toEqual([9, 5, 2]);
  });

  it('respects the limit after sorting, not before — the truncated entries are the real losers', async () => {
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeRow('a'), fakeRow('b'), fakeRow('c')]);
    mockedScore.mockReturnValueOnce(1).mockReturnValueOnce(3).mockReturnValueOnce(2);

    const result = await service.getTrending(2);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.trendingScore)).toEqual([3, 2]); // keeps the top 2, drops the real lowest (1)
  });

  it('returns an empty list, not an error, when nothing clears the gate', async () => {
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeRow('a')]);
    mockedScore.mockReturnValueOnce(null);

    const result = await service.getTrending(10);

    expect(result).toEqual([]);
  });
});
