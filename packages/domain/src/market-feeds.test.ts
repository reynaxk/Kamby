import { describe, expect, it } from 'vitest';
import { holderTier } from './market-feeds';

describe('holderTier', () => {
  it('labels $1M+ whale, $500K+ shark, $100K+ fish, and nothing below', () => {
    expect(holderTier(1_000_000)).toBe('whale');
    expect(holderTier(999_999)).toBe('shark');
    expect(holderTier(500_000)).toBe('shark');
    expect(holderTier(100_000)).toBe('fish');
    expect(holderTier(99_999)).toBeNull();
    expect(holderTier(Number.NaN)).toBeNull();
  });
});
