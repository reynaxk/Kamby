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
    candle: { findMany: jest.fn() },
    solanaTokenMarket: { findMany: jest.fn() },
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

    // Added 2026-09-27: 1m/5m are genuinely finer than anything the pre-materialized
    // `candles` table stores (its own native bucket is 5 minutes) — recovering 1-minute
    // detail from already-5-minute-bucketed rows is mathematically impossible, so these two
    // must read from raw `swaps` instead. Every other timeframe keeps reading `candles`,
    // same as before this feature existed.
    it('reads from raw swaps, not the pre-aggregated candles table, for a fine (1m) timeframe', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await service.getHistory(TOKEN_ADDRESS, 8453, '1m');

      const sqlFragments = (mockedPrisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[];
      const sql = sqlFragments.join('');
      expect(sql).toContain('FROM swaps');
      expect(sql).not.toContain('FROM candles');
      expect(sql).toContain('block_timestamp');
    });

    it('still reads from the pre-aggregated candles table for a coarse (1D) timeframe', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await service.getHistory(TOKEN_ADDRESS, 8453, '1D');

      const sqlFragments = (mockedPrisma.$queryRaw as jest.Mock).mock.calls[0][0] as string[];
      const sql = sqlFragments.join('');
      expect(sql).toContain('FROM candles');
      expect(sql).not.toContain('FROM swaps');
    });

    it('accepts both new fine timeframes (1m, 5m) and returns real parsed candles', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        { bucket_start: new Date('2026-09-27T00:00:00Z'), open: fakeDecimal(1), high: fakeDecimal(1.1), low: fakeDecimal(0.9), close: fakeDecimal(1.05), volume_usd: fakeDecimal(500) },
      ]);

      const result = await service.getHistory(TOKEN_ADDRESS, 8453, '5m');

      expect(result).toEqual([
        { bucketStart: '2026-09-27T00:00:00.000Z', open: 1, high: 1.1, low: 0.9, close: 1.05, volumeUsd: 500 },
      ]);
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

    it('reads recent traders from a bounded scan of the newest swaps and counts buyers/sellers in one SQL pass', async () => {
      (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(fakeMarketRow());
      const t = (min: number) => new Date(Date.UTC(2026, 8, 30, 12, 60 - min));
      (mockedPrisma.swap.findMany as jest.Mock)
        // 1st call: the newest swaps — 0xa traded twice; the repeat must not appear twice.
        .mockResolvedValueOnce([
          { traderAddress: '0xa', blockTimestamp: t(1) },
          { traderAddress: '0xb', blockTimestamp: t(2) },
          { traderAddress: '0xa', blockTimestamp: t(3) },
          { traderAddress: '0xc', blockTimestamp: t(4) },
        ])
        // 2nd call: large trades.
        .mockResolvedValueOnce([]);
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ buys: 648n, sells: 856n, buyers: 54n, sellers: 32n }]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([{ address: '0xb', user: { username: 'bee', avatarUrl: null } }]);

      const result = await service.getTokenTraders(TOKEN_ADDRESS, 8453, 2);

      expect(result.recentTraders.map((r) => [r.address, r.username])).toEqual([['0xa', null], ['0xb', 'bee']]);
      expect(result).toMatchObject({ buyCount24h: 648, sellCount24h: 856, buyerCount24h: 54, sellerCount24h: 32 });
      const [recentQuery, largeQuery] = (mockedPrisma.swap.findMany as jest.Mock).mock.calls.map(([arg]) => arg);
      expect(recentQuery).toMatchObject({ take: 500, orderBy: { blockTimestamp: 'desc' } });
      expect(recentQuery).not.toHaveProperty('distinct'); // Prisma dedupes `distinct` in memory after loading every row
      expect(largeQuery.where.blockTimestamp.gte).toBeInstanceOf(Date); // never an unbounded history scan
      expect(mockedPrisma.swap.count).not.toHaveBeenCalled();
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

const SOLANA_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function fakeSolanaRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'solana-market-1',
    mintAddress: SOLANA_MINT,
    symbol: 'BONK',
    name: 'Bonk',
    decimals: null,
    logoUrl: null,
    quoteMintAddress: 'So11111111111111111111111111111111111111112',
    quoteSymbol: 'SOL',
    dex: 'raydium',
    priceUsd: fakeDecimal(0.000003),
    liquidityUsd: fakeDecimal(400_000), // clears the real 10_000 minimum
    volume24hUsd: fakeDecimal(1_000_000),
    priceChange24hPct: fakeDecimal(5),
    marketCapUsd: fakeDecimal(2_000_000),
    lastPriceUpdateAt: new Date(), // fresh — clears the real staleness gate
    ...overrides,
  };
}

describe('MarketService — discover/search', () => {
  let service: MarketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarketService(new WatchlistService(), fakeConfigService());
    // Default: no candle history — most discover() tests aren't testing sparklines and would
    // otherwise crash on `undefined` from an unconfigured jest.fn(). Tests that actually care
    // override this with their own mockResolvedValue.
    (mockedPrisma.candle.findMany as jest.Mock).mockResolvedValue([]);
    // Every test below only cares about tokenMarket (EVM) rows unless it opts into a
    // Solana row explicitly — matches "no rows found yet" being the honest default.
    (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([]);
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

    it('attaches recentCloses for the sparkline, sampled from real candle history, oldest first', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow({ id: 'market-1' })]);
      (mockedPrisma.candle.findMany as jest.Mock).mockResolvedValue([
        { tokenMarketId: 'market-1', close: fakeDecimal(1.0) },
        { tokenMarketId: 'market-1', close: fakeDecimal(1.1) },
        { tokenMarketId: 'market-1', close: fakeDecimal(1.2) },
      ]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result[0]?.recentCloses).toEqual([1.0, 1.1, 1.2]);
    });

    it('never attaches recentCloses (not an empty array) for a market with fewer than 2 real candles — nothing to draw a trend from', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow({ id: 'market-1' })]);
      (mockedPrisma.candle.findMany as jest.Mock).mockResolvedValue([{ tokenMarketId: 'market-1', close: fakeDecimal(1.0) }]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result[0]?.recentCloses).toBeUndefined();
    });

    it('samples down to ~24 points for a market with far more raw candle history than that, never returning every raw point', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow({ id: 'market-1' })]);
      (mockedPrisma.candle.findMany as jest.Mock).mockResolvedValue(
        Array.from({ length: 288 }, (_, i) => ({ tokenMarketId: 'market-1', close: fakeDecimal(i) })), // a real 24h of 5-min candles
      );

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result[0]?.recentCloses).toHaveLength(24);
      // First and last raw points are preserved exactly — a sparkline that clips the real
      // start/end of the window would misrepresent the actual current trend.
      expect(result[0]?.recentCloses?.[0]).toBe(0);
      expect(result[0]?.recentCloses?.[23]).toBe(287);
    });

    it('only fetches candles for the returned page, never every scored candidate — one bounded batched query', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([
        fakeDiscoverableRow({ id: 'a', token: { ...fakeDiscoverableRow().token, symbol: 'A' }, volume24hUsd: fakeDecimal(3) }),
        fakeDiscoverableRow({ id: 'b', token: { ...fakeDiscoverableRow().token, symbol: 'B' }, volume24hUsd: fakeDecimal(2) }),
        fakeDiscoverableRow({ id: 'c', token: { ...fakeDiscoverableRow().token, symbol: 'C' }, volume24hUsd: fakeDecimal(1) }),
      ]);

      await service.discover({ sort: 'score', limit: 2 }); // only 2 of the 3 scored rows make the page

      expect(mockedPrisma.candle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tokenMarketId: { in: ['a', 'b'] } }) }),
      );
    });

    it('merges a real Solana row in alongside EVM rows, scored and sorted the same way', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow({ volume24hUsd: fakeDecimal(1) })]);
      (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([fakeSolanaRow()]);

      const result = await service.discover({ sort: 'volume', limit: 20 });

      expect(result.map((r) => r.chainIdentifier)).toEqual(['solana', 'eip155:8453']);
      expect(result[0]).toMatchObject({ tokenAddress: SOLANA_MINT, symbol: 'BONK' });
      expect(typeof result[0]?.discoveryScore).toBe('number');
    });

    it('excludes a Solana row the real scoring formula rejects, same gate as EVM rows', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([fakeSolanaRow({ liquidityUsd: fakeDecimal(100) })]);

      const result = await service.discover({ sort: 'score', limit: 20 });

      expect(result).toEqual([]);
    });
  });

  describe('recentlyListed', () => {
    it('returns only discovered markets, newest first, with when each was listed — never a seed-list token', async () => {
      const seed = fakeDiscoverableRow({ id: 'seed', createdAt: new Date('2026-09-30T02:00:00Z'), token: { contractAddress: '0x63706e401c06ac8513145b7687A14804d17f814b', symbol: 'AAVE', name: 'Aave', decimals: 18, logoUrl: null } });
      const fresh = fakeDiscoverableRow({ id: 'fresh', createdAt: new Date('2026-09-30T01:00:00Z') });
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([seed, fresh]);

      const result = await service.recentlyListed(72, 10);

      expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { gte: expect.any(Date) }, liquidityUsd: { gte: 10_000 } }, orderBy: { createdAt: 'desc' } }),
      );
      expect(result).toEqual([expect.objectContaining({ tokenAddress: TOKEN_ADDRESS, listedAtIso: '2026-09-30T01:00:00.000Z' })]);
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

    it('hides a near-empty pool from a name search, but still returns it for its exact address', async () => {
      const dust = fakeDiscoverableRow({ liquidityUsd: fakeDecimal(3) });
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([dust]);
      (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([]);

      expect(await service.search({ q: 'foo', limit: 10 })).toEqual([]);
      expect(await service.search({ q: TOKEN_ADDRESS, limit: 10 })).toEqual([expect.objectContaining({ tokenAddress: TOKEN_ADDRESS })]);
    });

    it('merges matching Solana rows in too, deliberately not chain-scoped — same reasoning as EVM', async () => {
      (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([]);
      (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([fakeSolanaRow()]);

      const result = await service.search({ q: 'bonk', limit: 10 });

      expect(mockedPrisma.solanaTokenMarket.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { symbol: { contains: 'bonk', mode: 'insensitive' } },
            { name: { contains: 'bonk', mode: 'insensitive' } },
            { mintAddress: { equals: 'bonk', mode: 'insensitive' } },
          ],
        },
        orderBy: { liquidityUsd: 'desc' },
        take: 10,
      });
      expect(result).toEqual([expect.objectContaining({ chainIdentifier: 'solana', tokenAddress: SOLANA_MINT })]);
    });
  });
});

describe('MarketService — Redis cache (2026-09-29 launch-load fix)', () => {
  function fakeRedis(store = new Map<string, string>()) {
    return {
      store,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (mockedPrisma.candle.findMany as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.solanaTokenMarket.findMany as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.tokenMarket.findMany as jest.Mock).mockResolvedValue([fakeDiscoverableRow()]);
  });

  it('serves a repeat discover() from cache without touching Postgres again', async () => {
    const redis = fakeRedis();
    const service = new MarketService(new WatchlistService(), fakeConfigService(), redis as never);
    const first = await service.discover({ sort: 'score', limit: 20 });
    const second = await service.discover({ sort: 'score', limit: 20 });
    expect(second).toEqual(first);
    expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('market:discover:score:20:', expect.any(String), 'EX', 10);
  });

  it('runs one query for a burst of identical concurrent misses, not one each', async () => {
    const service = new MarketService(new WatchlistService(), fakeConfigService(), fakeRedis() as never);
    await Promise.all(Array.from({ length: 10 }, () => service.discover({ sort: 'volume', limit: 50 })));
    expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledTimes(1);
  });

  it('keys by sort/limit/search, so different queries never share an entry', async () => {
    const service = new MarketService(new WatchlistService(), fakeConfigService(), fakeRedis() as never);
    await service.discover({ sort: 'score', limit: 20 });
    await service.discover({ sort: 'volume', limit: 20 });
    await service.discover({ sort: 'score', limit: 20, search: 'weth' });
    expect(mockedPrisma.tokenMarket.findMany).toHaveBeenCalledTimes(3);
  });

  it('falls through to Postgres when Redis is down, still returning a real result', async () => {
    const redis = { get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const service = new MarketService(new WatchlistService(), fakeConfigService(), redis as never);
    await expect(service.discover({ sort: 'score', limit: 20 })).resolves.toHaveLength(1);
  });

  it('never caches an error — a NotFound for an untracked token is recomputed next time', async () => {
    const redis = fakeRedis();
    const service = new MarketService(new WatchlistService(), fakeConfigService(), redis as never);
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.getTokenTraders(TOKEN_ADDRESS, 8453, 8)).rejects.toThrow(NotFoundException);
    await expect(service.getTokenTraders(TOKEN_ADDRESS, 8453, 8)).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
