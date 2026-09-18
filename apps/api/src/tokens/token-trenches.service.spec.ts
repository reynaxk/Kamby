import { prisma } from '@kamby/db';
import type { PumpFunTokenSummary } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { TokenTrenchesService } from './token-trenches.service';
import { TrenchesCategory } from './trenches-category.enum';

/** `byCategory`'s return type is a union across all four categories — a plain type
 *  assertion here is fine for a test asserting on the Pump.fun-shaped categories
 *  specifically, since the mocked prisma call controls what actually comes back. */
function asPumpFun(result: unknown): PumpFunTokenSummary[] {
  return result as PumpFunTokenSummary[];
}

jest.mock('@kamby/db', () => ({
  prisma: {
    tokenMarket: { findMany: jest.fn() },
    pumpFunToken: { findMany: jest.fn() },
  },
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

function pumpFunRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mintAddress: 'MintAddress11111111111111111111111111111',
    name: 'Test Coin',
    symbol: 'TEST',
    uri: 'https://example.com/meta.json',
    virtualSolReserves: '30000000000',
    virtualTokenReserves: '1073000000000000',
    realSolReserves: '1000000000',
    realTokenReserves: '793100000000000',
    tokenTotalSupply: '1000000000000000',
    complete: false,
    createdAt: new Date('2026-09-14T00:00:00Z'),
    lastStateUpdateAt: new Date('2026-09-14T00:00:00Z'),
    graduatedAt: null,
    ...overrides,
  };
}

describe('TokenTrenchesService', () => {
  let redis: Redis;
  let service: TokenTrenchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    service = new TokenTrenchesService(redis, fakeLogger());
  });

  describe('TRENDING_HOLDERS (existing EVM behavior, unchanged)', () => {
    it('returns markets clearing either the unique-traders or volume threshold', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([marketRow]);

      const result = await service.byCategory(TrenchesCategory.TRENDING_HOLDERS, 20);

      expect(result).toEqual([expect.objectContaining({ tokenAddress: '0xtoken', symbol: 'TOK' })]);
      const call = (mockedPrisma.tokenMarket.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.OR).toEqual([{ uniqueTraders24h: { gte: 500 } }, { volume24hUsd: { gte: 50_000 } }]);
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

  describe('FRESH', () => {
    it('queries incomplete Pump.fun tokens, newest first', async () => {
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([pumpFunRow()]);

      const result = await service.byCategory(TrenchesCategory.FRESH, 20);

      expect(result).toEqual([expect.objectContaining({ mintAddress: pumpFunRow().mintAddress, complete: false })]);
      const call = (mockedPrisma.pumpFunToken.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ complete: false });
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.take).toBe(20);
    });

    it('computes graduationProgressPct from real reserves, never leaves it undefined/fabricated at 0 by accident', async () => {
      // 42.5 SOL of 85 SOL threshold = exactly 50%.
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([pumpFunRow({ realSolReserves: '42500000000' })]);

      const result = await service.byCategory(TrenchesCategory.FRESH, 20);

      expect(result[0]).toMatchObject({ graduationProgressPct: 50 });
    });

    it('caps graduationProgressPct at 100 even if reserves have drifted past the threshold', async () => {
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([pumpFunRow({ realSolReserves: '999000000000' })]);

      const result = await service.byCategory(TrenchesCategory.FRESH, 20);

      expect(result[0]).toMatchObject({ graduationProgressPct: 100 });
    });
  });

  describe('NEAR_GRADUATED', () => {
    it('sorts by real SOL reserves numerically, never as a lexicographic string comparison', async () => {
      // A pure string sort would put '9000000000' (9 SOL) ahead of '80000000000' (80 SOL) —
      // '9' > '8' as the first character — despite 9 being the smaller number. This proves
      // the service gets this right.
      const smallButStringSortsFirst = pumpFunRow({ mintAddress: 'Small111111111111111111111111111111111111', realSolReserves: '9000000000' });
      const largeButStringSortsSecond = pumpFunRow({ mintAddress: 'Large111111111111111111111111111111111111', realSolReserves: '80000000000' });
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([smallButStringSortsFirst, largeButStringSortsSecond]);

      const result = asPumpFun(await service.byCategory(TrenchesCategory.NEAR_GRADUATED, 20));

      expect(result.map((r) => r.mintAddress)).toEqual([largeButStringSortsSecond.mintAddress, smallButStringSortsFirst.mintAddress]);
    });

    it('only ever considers incomplete curves', async () => {
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([]);

      await service.byCategory(TrenchesCategory.NEAR_GRADUATED, 20);

      const call = (mockedPrisma.pumpFunToken.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ complete: false });
    });

    it('respects the requested limit after sorting the candidate pool, not before', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        pumpFunRow({ mintAddress: `Mint${i}11111111111111111111111111111111111`, realSolReserves: String((i + 1) * 1_000_000_000) }),
      );
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue(rows);

      const result = asPumpFun(await service.byCategory(TrenchesCategory.NEAR_GRADUATED, 2));

      expect(result).toHaveLength(2);
      expect(result[0]?.mintAddress).toBe('Mint411111111111111111111111111111111111'); // highest reserves
    });
  });

  describe('JUST_GRADUATED', () => {
    it('queries complete Pump.fun tokens, most recently graduated first', async () => {
      (mockedPrisma.pumpFunToken.findMany as jest.Mock).mockResolvedValue([
        pumpFunRow({ complete: true, graduatedAt: new Date('2026-09-14T12:00:00Z') }),
      ]);

      const result = await service.byCategory(TrenchesCategory.JUST_GRADUATED, 20);

      expect(result).toEqual([expect.objectContaining({ complete: true, graduatedAt: '2026-09-14T12:00:00.000Z' })]);
      const call = (mockedPrisma.pumpFunToken.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ complete: true });
      expect(call.orderBy).toEqual({ graduatedAt: 'desc' });
    });
  });
});
