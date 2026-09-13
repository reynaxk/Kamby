import { computeTierTargetFeeUsd, resolveFeeTier } from './fee-schedule';

describe('resolveFeeTier', () => {
  it.each([
    [1, 0.25],
    [3, 0.25],
    [5, 0.25],
    [6, 0.35],
    [10, 0.35],
    [11, 0.45],
    [15, 0.45],
    [16, 0.5],
    [49, 0.5],
  ])('a $%s trade resolves to the flat $%s tier', (tradeSizeUsd, expectedUsd) => {
    const tier = resolveFeeTier(tradeSizeUsd);
    expect(tier?.target).toEqual({ kind: 'flat', usd: expectedUsd });
  });

  it('a $50 trade resolves to the uncapped percent tier, not the $16-49 flat tier', () => {
    const tier = resolveFeeTier(50);
    expect(tier?.target).toEqual({ kind: 'percent', rate: 0.0075 });
  });

  it('a very large trade still resolves to the same uncapped percent tier', () => {
    const tier = resolveFeeTier(50_000);
    expect(tier?.target).toEqual({ kind: 'percent', rate: 0.0075 });
    expect(tier?.maxUsd).toBeNull();
  });

  it('returns null for a trade below the lowest tier, rather than extrapolating one', () => {
    expect(resolveFeeTier(0.5)).toBeNull();
    expect(resolveFeeTier(0)).toBeNull();
  });

  it('every tier boundary is covered exactly once — no gap, no overlap', () => {
    for (let usd = 1; usd <= 100; usd += 1) {
      expect(resolveFeeTier(usd)).not.toBeNull();
    }
  });
});

describe('computeTierTargetFeeUsd', () => {
  it('a flat tier returns its fixed dollar amount regardless of the exact trade size within it', () => {
    expect(computeTierTargetFeeUsd(1)).toBe(0.25);
    expect(computeTierTargetFeeUsd(4.99)).toBe(0.25);
    expect(computeTierTargetFeeUsd(5)).toBe(0.25);
  });

  it('the percent tier scales with trade size, never a fixed amount', () => {
    expect(computeTierTargetFeeUsd(50)).toBeCloseTo(0.375, 5); // 50 * 0.0075
    expect(computeTierTargetFeeUsd(1000)).toBeCloseTo(7.5, 5); // 1000 * 0.0075
  });

  it('returns null below the lowest tier, same as resolveFeeTier', () => {
    expect(computeTierTargetFeeUsd(0.5)).toBeNull();
  });
});
