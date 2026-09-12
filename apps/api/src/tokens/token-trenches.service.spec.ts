import { NotImplementedException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { TokenTrenchesService } from './token-trenches.service';
import { TrenchesCategory } from './trenches-category.enum';

jest.mock('@kamby/db', () => ({
  prisma: { tokenMarket: { findMany: jest.fn() } },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeRedis(overrides: Partial<Record<'get' | 'set', jest.Mock>> = {}): Redis {
  return {
    get: overrides.get ?? jest.fn().mockResolvedValue(null),
    set: overrides.set ?? jest.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const marketRow = {
  id: 'market-1',
  chain: { identifier: 'eip155:8453' },
  token: { contractAddress: '0xtoken', symbol: 'TOK', name: 'Token', decimals: 18, logoUrl: null },
  quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
  dex: 'uniswap-v3',
  feeTier: 3000,
  priceUsd: 1,
  liquidityUsd: 50_000,
  volume24hUsd: 100_000,
  priceChange24hPct: 5,
  marketCapUsd: null,
  lastPriceUpdateAt: new Date(),
  uniqueTraders24h: 600,
  tradeCount24h: 900,
};

describe('TokenTrenchesService', () => {
  let redis: Redis;
  let service: TokenTrenchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    service = new TokenTrenchesService(redis, fakeLogger());
  });

  it('rejects the pre-liquidity bonding-curve categories with an honest 501, never an empty/fabricated result', async () => {
    for (const category of [TrenchesCategory.FRESH, TrenchesCategory.NEAR_GRADUATED, TrenchesCategory.JUST_GRADUATED]) {
      await expect(service.byCategory(category, 20)).rejects.toThrow(NotImplementedException);
    }
    expect(mockedPrisma.tokenMarket.findMany).not.toHaveBeenCalled();
  });

  it('returns markets clearing either the unique-traders or volume threshold', async () => {
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([marketRow]);

    const result = await service.byCategory(TrenchesCategory.TRENDING_HOLDERS, 20);

    expect(result).toEqual([expect.objectContaining({ tokenAddress: '0xtoken', symbol: 'TOK' })]);
    const call = (mockedPrisma.tokenMarket.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { uniqueTraders24h: { gte: 500 } },
      { volume24hUsd: { gte: 50_000 } },
    ]);
    expect(call.take).toBe(20);
  });

  it('serves from cache on a hit without querying Postgres', async () => {
    redis = fakeRedis({ get: jest.fn().mockResolvedValue(JSON.stringify([{ tokenAddress: '0xcached' }])) });
    service = new TokenTrenchesService(redis, fakeLogger());

    const result = await service.byCategory(TrenchesCategory.TRENDING_HOLDERS, 20);

    expect(result).toEqual([{ tokenAddress: '0xcached' }]);
    expect(mockedPrisma.tokenMarket.findMany).not.toHaveBeenCalled();
  });

  it('degrades to computing fresh (never throws) when the cache read fails', async () => {
    redis = fakeRedis({ get: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
    service = new TokenTrenchesService(redis, fakeLogger());
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([marketRow]);

    const result = await service.byCategory(TrenchesCategory.TRENDING_HOLDERS, 20);

    expect(result).toHaveLength(1);
  });

  it('still returns the computed result even when the cache write fails', async () => {
    redis = fakeRedis({ set: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
    service = new TokenTrenchesService(redis, fakeLogger());
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([marketRow]);

    const result = await service.byCategory(TrenchesCategory.TRENDING_HOLDERS, 20);

    expect(result).toHaveLength(1);
  });
});
