import { withFreshPrice } from './feed-prices.service';

describe('withFreshPrice', () => {
  const row = { priceUsd: 0.01, marketCapUsd: 1_000_000, priceChange24hPct: 50, lastPriceUpdateAt: 'old' };

  it('moves price, market cap and the 24h change together', () => {
    const fresh = withFreshPrice(row, 0.0128, 'now'); // +28%, the CZ case from the audit
    expect(fresh.priceUsd).toBe(0.0128);
    expect(fresh.marketCapUsd).toBeCloseTo(1_280_000);
    expect(fresh.priceChange24hPct).toBeCloseTo(92); // 1.5 × 1.28 = 1.92 → +92%
    expect(fresh.lastPriceUpdateAt).toBe('now');
  });

  it('never replaces a price with nothing, zero or junk', () => {
    expect(withFreshPrice(row, undefined, 'now')).toBe(row);
    expect(withFreshPrice(row, 0, 'now')).toBe(row);
    expect(withFreshPrice(row, Number.NaN, 'now')).toBe(row);
  });
});
