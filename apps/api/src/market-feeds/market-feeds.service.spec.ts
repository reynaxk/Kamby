import type { MarketSummary, PumpFunLiveBatch } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { BehaviorSubject, Subject, take, toArray, firstValueFrom, filter } from 'rxjs';
import type { MarketService } from '../market/market.service';
import type { RealtimeService } from '../realtime/realtime.service';
import type { TokenTrenchesService } from '../tokens/token-trenches.service';
import type { CryptoPriceService } from './crypto-price.service';
import { MarketFeedsService, mixChains, toFeedMarket, trendingMarkets } from './market-feeds.service';

const logger = { setContext: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;
const REAL_AAVE = '0x63706e401c06ac8513145b7687A14804d17f814b'; // on the Base seed list

function market(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'eip155:8453',
    tokenAddress: '0x0000000000000000000000000000000000000001',
    symbol: 'NEW',
    name: 'New',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'WETH',
    quoteAddress: '0x4200000000000000000000000000000000000006',
    quoteDecimals: 18,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 1,
    liquidityUsd: 50_000,
    volume24hUsd: 1_000,
    priceChange24hPct: 0,
    marketCapUsd: null,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

function setup() {
  const pumpfun = new Subject<PumpFunLiveBatch>();
  const marketService = {
    discover: jest.fn().mockResolvedValue([market({ tokenAddress: REAL_AAVE, symbol: 'AAVE' })]),
    recentlyListed: jest.fn().mockResolvedValue([{ ...market(), listedAtIso: '2026-09-30T00:00:00.000Z' }]),
  };
  const trenches = { byCategory: jest.fn().mockResolvedValue([]) };
  const crypto = { prices$: new BehaviorSubject([]), snapshot: jest.fn().mockReturnValue([]) };
  const realtime = { pumpFunEvents$: pumpfun.asObservable() };
  const service = new MarketFeedsService(
    marketService as unknown as MarketService,
    trenches as unknown as TokenTrenchesService,
    crypto as unknown as CryptoPriceService,
    realtime as unknown as RealtimeService,
    logger,
    { attach: async (t: unknown) => t } as never,
  );
  return { service, marketService, pumpfun };
}

describe('toFeedMarket', () => {
  it('marks seed-list and Solana markets vetted, and everything else new', () => {
    expect(toFeedMarket(market({ tokenAddress: REAL_AAVE })).listing).toBe('vetted');
    expect(toFeedMarket(market({ chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' })).listing).toBe('vetted');
    expect(toFeedMarket(market()).listing).toBe('new');
  });
});

describe('MarketFeedsService', () => {
  it('sends every tab to a new viewer right away, with trending rows labelled', async () => {
    const { service } = setup();
    const events = await firstValueFrom(service.stream().pipe(filter((e) => e.type !== 'heartbeat'), take(4), toArray()));

    expect(events.map((e) => e.type).sort()).toEqual(['bonding', 'graduated', 'trenches', 'trending']);
    const trending = events.find((e) => e.type === 'trending')!.data as { markets: { symbol: string; listing: string }[] };
    expect(trending.markets).toEqual([expect.objectContaining({ symbol: 'AAVE', listing: 'vetted' })]);
    const graduated = events.find((e) => e.type === 'graduated')!.data as { markets: { listing: string; listedAtIso: string }[] };
    expect(graduated.markets).toEqual([expect.objectContaining({ listing: 'new', listedAtIso: '2026-09-30T00:00:00.000Z' })]);
  });

  it('shares one rebuild across many viewers instead of querying per viewer', async () => {
    const { service, marketService } = setup();
    await Promise.all([1, 2, 3].map(() => firstValueFrom(service.stream().pipe(filter((e) => e.type === 'trending')))));

    expect(marketService.discover).toHaveBeenCalledTimes(1);
  });

  it('forwards Pump.fun changes from the workers as they arrive', async () => {
    const { service, pumpfun } = setup();
    const next = firstValueFrom(service.stream().pipe(filter((e) => e.type === 'pumpfun')));
    pumpfun.next({ tokens: [], atIso: '2026-09-30T00:00:00.000Z' });

    expect((await next).data).toEqual({ tokens: [], atIso: '2026-09-30T00:00:00.000Z' });
  });

  it('keeps the stream alive when one tab fails to build', async () => {
    const { service, marketService } = setup();
    marketService.discover.mockRejectedValueOnce(new Error('db down'));
    const events = await firstValueFrom(service.stream().pipe(filter((e) => e.type !== 'heartbeat'), take(3), toArray()));

    expect(events.map((e) => e.type)).not.toContain('trending');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ tab: 'trending' }), expect.any(String));
  });
});

describe('trendingMarkets', () => {
  const m = (symbol: string, marketCapUsd: number | null, chainIdentifier = 'solana') => ({ symbol, marketCapUsd, chainIdentifier });
  it('leaves out stablecoins, wrapped majors and $500M+ coins, keeping score order', () => {
    const many = Array.from({ length: 20 }, (_, i) => m(`MEME${i}`, 1_000_000));
    const out = trendingMarkets([m('WETH', 7e8), m('USDT', 9e9), m('JUP', 1.06e9), ...many]);
    expect(out.map((x) => x.symbol)).toEqual(many.map((x) => x.symbol));
  });
  it('tops up from the majors when too few coins remain, so the tab is never empty', () => {
    const out = trendingMarkets([m('AAA', 1e6), m('WETH', 7e8)]);
    expect(out.map((x) => x.symbol)).toEqual(['AAA', 'WETH']);
  });
});

describe('mixChains', () => {
  it('alternates chains while keeping each chain in its own score order', () => {
    const r = [{ id: 's1', chainIdentifier: 'solana' }, { id: 's2', chainIdentifier: 'solana' }, { id: 's3', chainIdentifier: 'solana' }, { id: 'b1', chainIdentifier: 'eip155:56' }, { id: 'e1', chainIdentifier: 'eip155:8453' }];
    expect(mixChains(r).map((x) => x.id)).toEqual(['s1', 'b1', 'e1', 's2', 's3']);
  });
});
