import type { PinoLogger } from 'nestjs-pino';
import { CryptoPriceService, priceFromTicker } from './crypto-price.service';

const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;

// A real ticker frame captured from Coinbase's public feed on 2026-09-30.
const REAL_BTC_TICKER = { type: 'ticker', product_id: 'BTC-USD', price: '83875.98', open_24h: '84308.87', time: '2026-09-30T12:25:08.598637Z' };

describe('priceFromTicker', () => {
  it('reads price and the change vs Coinbase\'s own 24h open', () => {
    const price = priceFromTicker(REAL_BTC_TICKER)!;
    expect(price).toMatchObject({ symbol: 'BTC', priceUsd: 83875.98, updatedAtIso: REAL_BTC_TICKER.time });
    expect(price.change24hPct).toBeCloseTo(-0.5135, 3);
  });

  it('leaves the 24h change null rather than inventing one when there is no open', () => {
    expect(priceFromTicker({ ...REAL_BTC_TICKER, open_24h: undefined })!.change24hPct).toBeNull();
  });

  it('ignores non-ticker frames, unknown products and unusable prices', () => {
    expect(priceFromTicker({ type: 'subscriptions' })).toBeNull();
    expect(priceFromTicker({ ...REAL_BTC_TICKER, product_id: 'DOGE-USD' })).toBeNull();
    expect(priceFromTicker({ ...REAL_BTC_TICKER, price: 'NaN' })).toBeNull();
    expect(priceFromTicker({ ...REAL_BTC_TICKER, price: '0' })).toBeNull();
  });
});

describe('CryptoPriceService', () => {
  it('emits the latest price per major, in a fixed order, only when something changed', () => {
    const service = new CryptoPriceService(logger);
    const emitted: string[][] = [];
    service.prices$.subscribe((prices) => emitted.push(prices.map((p) => `${p.symbol}:${p.priceUsd}`)));

    service.handleMessage({ ...REAL_BTC_TICKER, product_id: 'SOL-USD', price: '119.73' });
    service.handleMessage(REAL_BTC_TICKER);
    service.handleMessage({ ...REAL_BTC_TICKER, price: '83900' }); // same symbol, later tick wins
    service.emitIfDirty();
    service.emitIfDirty(); // nothing new — no second emission

    expect(emitted).toEqual([[], ['BTC:83900', 'SOL:119.73']]);
  });
});
