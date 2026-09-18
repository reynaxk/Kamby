import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { MarketService } from './market.service';
import { WatchlistService } from './watchlist.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    tokenMarket: { findFirst: jest.fn() },
    swap: { findMany: jest.fn(), groupBy: jest.fn() },
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
    service = new MarketService(new WatchlistService());
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
});
