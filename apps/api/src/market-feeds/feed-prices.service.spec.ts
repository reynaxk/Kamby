import { withFreshPrice } from './feed-prices.service';

describe('withFreshPrice', () => {
  const now = Date.parse('2026-10-31T16:00:00Z');
  const row = { priceUsd: 0.01, marketCapUsd: 1_000_000, priceChange24hPct: 50, lastPriceUpdateAt: '2026-10-31T15:59:00Z' };

  it('moves price, market cap and the 24h change together', () => {
    const fresh = withFreshPrice(row, 0.0128, 'now', undefined, now); // +28%, the CZ case from the audit
    expect(fresh.priceUsd).toBe(0.0128);
    expect(fresh.marketCapUsd).toBeCloseTo(1_280_000);
    expect(fresh.priceChange24hPct).toBeCloseTo(92); // 1.5 × 1.28 = 1.92 → +92%
    expect(fresh.lastPriceUpdateAt).toBe('now');
  });

  it("uses the price source's own 24h change when it has one", () => {
    expect(withFreshPrice(row, 0.0128, 'now', 404, now).priceChange24hPct).toBe(404);
  });

  it('never re-bases on a stored price hours old (the +2.8K% vs +404% case)', () => {
    const old = { ...row, priceChange24hPct: 404, lastPriceUpdateAt: '2026-10-31T10:00:00Z' };
    const fresh = withFreshPrice(old, 0.057, 'now', undefined, now);
    expect(fresh.priceChange24hPct).toBe(404);
    expect(fresh.priceUsd).toBe(0.057);
  });

  it('never replaces a price with nothing, zero or junk', () => {
    expect(withFreshPrice(row, undefined, 'now')).toBe(row);
    expect(withFreshPrice(row, 0, 'now')).toBe(row);
    expect(withFreshPrice(row, Number.NaN, 'now')).toBe(row);
  });
});
