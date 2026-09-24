import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import type { Env } from '../config/env';
import { MarketService } from './market.service';
import { WatchlistService } from './watchlist.service';

function fakeConfigService(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values: Partial<Env> = { CHAINS: 'base', CHAIN_BASE_ID: 8453, CHAIN_BASE_RPC_URL: 'https://example.test', CHAIN_BASE_USDC_ADDRESS: '0xusdc', ...overrides };
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

jest.mock('@kamby/db', () => ({
  prisma: {
    tokenMarket: { findFirst: jest.fn(), findMany: jest.fn() },
    swap: { findMany: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
    wallet: { findMany: jest.fn() },
    tokenWatch: { count: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const TOKEN_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fakeMarketRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'market-1',
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: null,
    liquidityUsd: null,
    volume24hUsd: null,
    priceChange24hPct: null,
    marketCapUsd: null,
    lastPriceUpdateAt: null,
    uniqueTraders24h: 0,
    token: { contractAddress: TOKEN_ADDRESS, symbol: 'FOO', name: 'Foo', decimals: 18, logoUrl: null },
    quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
    chain: { identifier: 'eip155:8453' },
    ...overrides,
  };
}

// Every test below exists because of a real incident (2026-09-15): TokenMarket.chainId is
// Chain's own internal autoincrement row id, not the real numeric EVM chain id these
// methods receive — filtering with a bare `chainId: chainId` silently matched nothing,
// 404ing every token detail/history/traders lookup for every real token. The fix filters
// via the `chain` relation's real `identifier` instead; these tests pin that shape down so
// it can't silently regress back to a bare chainId comparison.
describe('MarketService — chain scoping (2026-09-15 chainId/Chain.id mismatch fix)', () => {
  let service: MarketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarketService(new WatchlistService(), fakeConfigService());
  });

  describe('getToken', () => {
    it('filters via chain.identifier, not a bare chainId', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());

      await service.getToken(TOKEN_ADDRESS, 8453);

      expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ chain: { identifier: 'eip155:8453' } }) }),
      );
    });

    it('resolves the market on the chain actually requested, not whichever chain answers first', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockImplementation(
        async ({ where }: { where: { chain: { identifier: string } } }) =>
          where.chain.identifier === 'eip155:42161' ? fakeMarketRow({ id: 'market-arbitrum' }) : null,
      );

      const result = await service.getToken(TOKEN_ADDRESS, 42161);

      expect(result.tokenAddress).toBe(TOKEN_ADDRESS);
    });

    it('404s for an unconfigured chain id rather than querying with a meaningless filter', async () => {
      await expect(service.getToken(TOKEN_ADDRESS, 999_999)).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
    });

    it('404s when no market exists for this token on this chain', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getToken(TOKEN_ADDRESS, 8453)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('filters via chain.identifier, not a bare chainId', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await service.getHistory(TOKEN_ADDRESS, 8453, '1D');

      expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ chain: { identifier: 'eip155:8453' } }) }),
      );
    });

    it('404s for an unconfigured chain id rather than querying with a meaningless filter', async () => {
      await expect(service.getHistory(TOKEN_ADDRESS, 999_999, '1D')).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getTokenTraders', () => {
    beforeEach(() => {
      (mockedPrisma.swap.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.swap.groupBy as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.swap.count as jest.Mock).mockResolvedValue(0);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.tokenWatch.count as jest.Mock).mockResolvedValue(0);
    });

    it('filters via chain.identifier, not a bare chainId', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());

      await service.getTokenTraders(TOKEN_ADDRESS, 8453, 10);

      expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ chain: { identifier: 'eip155:8453' } }) }),
      );
    });

    it('404s for an unconfigured chain id rather than querying with a meaningless filter', async () => {
      await expect(service.getTokenTraders(TOKEN_ADDRESS, 999_999, 10)).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getChains', () => {
    it('returns the exact USDC address every trading service already trades against — never a second, independently-sourced value', () => {
      const withConfig = new MarketService(
        new WatchlistService(),
        fakeConfigService({ CHAINS: 'base,bnb', CHAIN_BNB_ID: 56, CHAIN_BNB_RPC_URL: 'https://bnb.test', CHAIN_BNB_USDC_ADDRESS: '0xbnbusdc' }),
      );

      expect(withConfig.getChains()).toEqual([
        { slug: 'base', chainId: 8453, usdcAddress: '0xusdc' },
        { slug: 'bnb', chainId: 56, usdcAddress: '0xbnbusdc' },
      ]);
    });

    it('never leaks rpcUrl/rpcUrlFallback — operational detail the frontend has no use for', () => {
      const chains = service.getChains();
      expect(chains[0]).not.toHaveProperty('rpcUrl');
      expect(chains[0]).not.toHaveProperty('rpcUrlFallback');
    });
  });
});

// decimal.js-shaped fake — real Prisma rows carry Prisma.Decimal, not plain numbers, for
// these fields; Number(x) needs toString/valueOf, and the service's own numDesc needs
// toNumber(), so a bare number would silently satisfy neither call correctly.
function fakeDecimal(n: number) {
  return { toNumber: () => n, toString: () => String(n), valueOf: () => String(n) };
}

function fakeDiscoverableRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'market-1',
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: fakeDecimal(1),
    liquidityUsd: fakeDecimal(50_000), // clears the real 10_000 minimum
    volume24hUsd: fakeDecimal(100_000),
    priceChange24hPct: fakeDecimal(5),
    marketCapUsd: fakeDecimal(1_000_000),
    lastPriceUpdateAt: new Date(), // fresh — clears the real staleness gate
    uniqueTraders24h: 0,
    token: { contractAddress: TOKEN_ADDRESS, symbol: 'FOO', name: 'Foo Token', decimals: 18, logoUrl: null },
    quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
    chain: { identifier: 'eip155:8453' },
    ...overrides,
  };
}

describe('MarketService — discover/search', () => {
  let service: MarketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarketService(new WatchlistService(), fakeConfigService());
  });

  describe('discover', () => {
    it('excludes a market the real scoring formula rejects (stale, below the liquidity gate, or missing inputs)', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        fakeDiscoverableRow({ id: 'good' }),
        fakeDiscoverableRow({ id: 'stale', lastPriceUpdateAt: new Date(Date.now() - 60 * 60_000) }), // 1h old, gate is 30m
        fakeDiscoverableRow({ id: 'illiquid', liquidityUsd: fakeDecimal(100) }), // below the 10_000 floor
        fakeDiscoverableRow({ id: 'no-volume', volume24hUsd: null }),
      ]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result.map((r) => r.tokenAddress)).toEqual([TOKEN_ADDRESS]); // only "good" survived
    });

    it('ranks by real computed score descending by default', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        fakeDiscoverableRow({ id: 'low', token: { ...fakeDiscoverableRow().token, symbol: 'LOW' }, volume24hUsd: fakeDecimal(100) }),
        fakeDiscoverableRow({ id: 'high', token: { ...fakeDiscoverableRow().token, symbol: 'HIGH' }, volume24hUsd: fakeDecimal(10_000_000) }),
      ]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
    });

    it('sorts by the real requested field (volume) instead of score when asked', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        // Deliberately inverted: the higher-volume row has the lower momentum, so a
        // score-sort and a volume-sort would disagree — proving `sort` actually changes
        // the real order rather than the default happening to already match.
        fakeDiscoverableRow({ id: 'a', token: { ...fakeDiscoverableRow().token, symbol: 'A' }, volume24hUsd: fakeDecimal(1_000), priceChange24hPct: fakeDecimal(50) }),
        fakeDiscoverableRow({ id: 'b', token: { ...fakeDiscoverableRow().token, symbol: 'B' }, volume24hUsd: fakeDecimal(1_000_000), priceChange24hPct: fakeDecimal(-50) }),
      ]);

      const result = await service.discover({ sort: 'volume', limit: 20 });

      expect(result.map((r) => r.symbol)).toEqual(['B', 'A']);
    });

    it('applies the real search filter before ranking, matching symbol/name/contractAddress case-insensitively', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        fakeDiscoverableRow({ id: 'match', token: { ...fakeDiscoverableRow().token, symbol: 'PEPE', contractAddress: '0xaaa' } }),
        fakeDiscoverableRow({ id: 'no-match', token: { ...fakeDiscoverableRow().token, symbol: 'DOGE', contractAddress: '0xbbb' } }),
      ]);

      const result = await service.discover({ sort: 'score', limit: 20, search: 'pep' });

      expect(result.map((r) => r.symbol)).toEqual(['PEPE']);
    });

    it('respects the real limit even when more rows qualify, keeping the top-ranked ones', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        fakeDiscoverableRow({ id: 'a', token: { ...fakeDiscoverableRow().token, symbol: 'A' }, volume24hUsd: fakeDecimal(3_000) }),
        fakeDiscoverableRow({ id: 'b', token: { ...fakeDiscoverableRow().token, symbol: 'B' }, volume24hUsd: fakeDecimal(2_000) }),
        fakeDiscoverableRow({ id: 'c', token: { ...fakeDiscoverableRow().token, symbol: 'C' }, volume24hUsd: fakeDecimal(1_000) }),
      ]);

      const result = await service.discover({ sort: 'score', limit: 2 });

      expect(result.map((r) => r.symbol)).toEqual(['A', 'B']);
    });

    it('always attaches a real discoveryScore field, unlike search results', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow()]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(typeof result[0]?.discoveryScore).toBe('number');
    });
  });

  describe('search', () => {
    it('builds the real case-insensitive OR filter across symbol, name, and contractAddress', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);

      await service.search({ q: 'PePe', limit: 10 });

      expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { token: { symbol: { contains: 'PePe', mode: 'insensitive' } } },
            { token: { name: { contains: 'PePe', mode: 'insensitive' } } },
            { token: { contractAddress: { equals: 'PePe', mode: 'insensitive' } } },
          ],
        },
        include: expect.anything(),
        orderBy: { liquidityUsd: 'desc' },
        take: 10,
      });
    });

    it('never attaches a discoveryScore field — search results are not ranked', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow()]);

      const result = await service.search({ q: 'foo', limit: 10 });

      expect(result[0]).not.toHaveProperty('discoveryScore');
    });
  });
});
