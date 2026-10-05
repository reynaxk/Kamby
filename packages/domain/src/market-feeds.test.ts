import { describe, expect, it } from 'vitest';
import { applyFeedList, diffFeedList, holderTier } from './market-feeds';

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

describe('diffFeedList / applyFeedList', () => {
  const m = (addr: string, price: number, extra: Record<string, unknown> = {}) => ({ chainIdentifier: 'solana', tokenAddress: addr, priceUsd: price, symbol: addr, ...extra });

  it('round-trips joins, leaves, reorders and field changes, sending only what changed', () => {
    const prev = [m('A', 1), m('B', 2), m('C', 3)];
    const next = [m('C', 3), m('A', 1.5), m('D', 9)]; // reorder, A re-priced, B left, D joined
    const patch = diffFeedList(prev, next)!;
    expect(patch.order).toEqual(['solana:C', 'solana:A', 'solana:D']);
    expect(patch.rows).toEqual({ 'solana:A': { priceUsd: 1.5 }, 'solana:D': m('D', 9) }); // C unchanged → not sent
    expect(applyFeedList(prev, patch)).toEqual(next);
  });

  it('reports no change as null, and an impossible patch as null (needs a resync)', () => {
    expect(diffFeedList([m('A', 1)], [m('A', 1)])).toBeNull();
    expect(applyFeedList([], { order: ['solana:Z'], rows: {} })).toBeNull();
  });

  it('keys Pump.fun tokens by mint', () => {
    const t = (mint: string, r: string) => ({ mintAddress: mint, realSolReserves: r });
    expect(diffFeedList([t('M1', '1')], [t('M1', '2')])).toEqual({ order: ['M1'], rows: { M1: { realSolReserves: '2' } } });
  });
});
