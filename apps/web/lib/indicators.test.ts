import { describe, expect, it } from 'vitest';
import { computeAdx, computeAtr, computeAwesomeOscillator, computeBollingerBands, computePeriodHighLow } from './indicators';
import type { Candle } from '@kamby/domain';

function candle(i: number, overrides: Partial<Candle> = {}): Candle {
  const base = 100 + Math.sin(i / 3) * 10;
  return {
    bucketStart: new Date(2026, 0, 1, i).toISOString(),
    open: base,
    high: base + 2,
    low: base - 2,
    close: base + (i % 2 === 0 ? 1 : -1),
    volumeUsd: 1000,
    ...overrides,
  };
}

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(i));
}

describe('computeBollingerBands', () => {
  it('produces one aligned point per candle after the warm-up period, upper always >= middle >= lower', () => {
    const input = candles(40);
    const { upper, middle, lower } = computeBollingerBands(input, 20, 2);

    expect(upper).toHaveLength(input.length - 19); // period - 1 warm-up candles have no value yet
    expect(upper.length).toBe(middle.length);
    expect(middle.length).toBe(lower.length);
    for (let i = 0; i < upper.length; i++) {
      expect(upper[i]!.value).toBeGreaterThanOrEqual(middle[i]!.value);
      expect(middle[i]!.value).toBeGreaterThanOrEqual(lower[i]!.value);
    }
  });

  it('aligns each point to its real candle timestamp, not a shifted one', () => {
    const input = candles(25);
    const { middle } = computeBollingerBands(input, 20, 2);

    const expectedFirstTime = Math.floor(new Date(input[19]!.bucketStart).getTime() / 1000);
    expect(middle[0]!.time).toBe(expectedFirstTime);
  });
});

describe('computeAtr / computeAdx / computeAwesomeOscillator', () => {
  it('all return real, finite numbers with no NaN/undefined after warm-up', () => {
    const input = candles(60);
    for (const series of [computeAtr(input), computeAdx(input), computeAwesomeOscillator(input)]) {
      expect(series.length).toBeGreaterThan(0);
      expect(series.every((p) => Number.isFinite(p.value))).toBe(true);
    }
  });

  it('ADX stays within its real 0-100 range', () => {
    const result = computeAdx(candles(60));
    expect(result.every((p) => p.value >= 0 && p.value <= 100)).toBe(true);
  });
});

describe('computePeriodHighLow', () => {
  it('returns null for no candles, rather than a fabricated 0/0', () => {
    expect(computePeriodHighLow([])).toBeNull();
  });

  it('returns the real max high / min low across the given candles only — not a fixed 52-week claim', () => {
    const input: Candle[] = [candle(0, { high: 120, low: 90 }), candle(1, { high: 130, low: 80 }), candle(2, { high: 110, low: 95 })];
    expect(computePeriodHighLow(input)).toEqual({ high: 130, low: 80 });
  });
});
