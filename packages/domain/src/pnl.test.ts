import { describe, expect, it } from 'vitest';
import { computeFifoRealizedPnl, matchFifoSell, type OpenLot, PNL_WINDOW_MS, toPnlWindowStats } from './pnl';

function lot(overrides: Partial<OpenLot> = {}): OpenLot {
  return {
    id: 'lot-1',
    quantityOriginalRaw: '100',
    quantityRemainingRaw: '100',
    costBasisUsd: 50,
    ...overrides,
  };
}

describe('matchFifoSell', () => {
  it('matches exactly against a single lot with no remainder', () => {
    const result = matchFifoSell([lot({ id: 'lot-1' })], '100');
    expect(result.matches).toEqual([{ lotId: 'lot-1', quantityMatchedRaw: '100', costBasisUsd: 50 }]);
    expect(result.unmatchedQuantityRaw).toBe('0');
  });

  it('partially consumes a single lot, leaving it (implicitly) still open', () => {
    const result = matchFifoSell([lot({ id: 'lot-1', quantityOriginalRaw: '100', quantityRemainingRaw: '100', costBasisUsd: 100 })], '40');
    expect(result.matches).toEqual([{ lotId: 'lot-1', quantityMatchedRaw: '40', costBasisUsd: 40 }]);
    expect(result.unmatchedQuantityRaw).toBe('0');
  });

  it('prices a partial match proportionally against the lot total, not the remaining amount', () => {
    // A lot already partially consumed by an earlier sell: 100 original, 60 remaining,
    // cost basis is still for the full original 100 ($100 total = $1/unit).
    const partiallyConsumed = lot({ id: 'lot-1', quantityOriginalRaw: '100', quantityRemainingRaw: '60', costBasisUsd: 100 });
    const result = matchFifoSell([partiallyConsumed], '60');
    expect(result.matches).toEqual([{ lotId: 'lot-1', quantityMatchedRaw: '60', costBasisUsd: 60 }]);
  });

  it('consumes multiple lots oldest-first when one lot is not enough', () => {
    const lots = [
      lot({ id: 'oldest', quantityOriginalRaw: '30', quantityRemainingRaw: '30', costBasisUsd: 30 }),
      lot({ id: 'newer', quantityOriginalRaw: '100', quantityRemainingRaw: '100', costBasisUsd: 200 }),
    ];
    const result = matchFifoSell(lots, '50');
    expect(result.matches).toEqual([
      { lotId: 'oldest', quantityMatchedRaw: '30', costBasisUsd: 30 },
      { lotId: 'newer', quantityMatchedRaw: '20', costBasisUsd: 40 }, // 20/100 * 200
    ]);
    expect(result.unmatchedQuantityRaw).toBe('0');
  });

  it('returns the full sell as unmatched when there are no open lots at all', () => {
    const result = matchFifoSell([], '100');
    expect(result.matches).toEqual([]);
    expect(result.unmatchedQuantityRaw).toBe('100');
  });

  it('returns the excess as unmatched when a sell exceeds every open lot combined — never fabricates a match', () => {
    const lots = [lot({ id: 'lot-1', quantityOriginalRaw: '10', quantityRemainingRaw: '10', costBasisUsd: 10 })];
    const result = matchFifoSell(lots, '30');
    expect(result.matches).toEqual([{ lotId: 'lot-1', quantityMatchedRaw: '10', costBasisUsd: 10 }]);
    expect(result.unmatchedQuantityRaw).toBe('20');
  });

  it('skips a fully-consumed lot (quantityRemainingRaw "0") and moves to the next', () => {
    const lots = [
      lot({ id: 'exhausted', quantityOriginalRaw: '50', quantityRemainingRaw: '0', costBasisUsd: 50 }),
      lot({ id: 'open', quantityOriginalRaw: '50', quantityRemainingRaw: '50', costBasisUsd: 25 }),
    ];
    const result = matchFifoSell(lots, '10');
    expect(result.matches).toEqual([{ lotId: 'open', quantityMatchedRaw: '10', costBasisUsd: 5 }]);
  });

  it('rejects a negative sell quantity', () => {
    expect(() => matchFifoSell([], '-1')).toThrow();
  });
});

describe('computeFifoRealizedPnl', () => {
  it('computes proceeds and realized PnL for a fully-matched sell', () => {
    const result = computeFifoRealizedPnl([lot({ id: 'lot-1', costBasisUsd: 50 })], '100', 80);
    expect(result.matches).toEqual([
      { lotId: 'lot-1', quantityMatchedRaw: '100', costBasisUsd: 50, proceedsUsd: 80, realizedPnlUsd: 30 },
    ]);
  });

  it('allocates proceeds by each match\'s share of the FULL sell quantity, including any unmatched excess', () => {
    // Only 10 of 30 sold units are matched (20 unmatched) — the matched 10 units should
    // get 10/30 of the $60 total proceeds ($20), not 100% of it.
    const lots = [lot({ id: 'lot-1', quantityOriginalRaw: '10', quantityRemainingRaw: '10', costBasisUsd: 10 })];
    const result = computeFifoRealizedPnl(lots, '30', 60);
    expect(result.matches).toEqual([
      { lotId: 'lot-1', quantityMatchedRaw: '10', costBasisUsd: 10, proceedsUsd: 20, realizedPnlUsd: 10 },
    ]);
    expect(result.unmatchedQuantityRaw).toBe('20');
  });

  it('reports a real loss (negative realizedPnlUsd) honestly, never clamped to zero', () => {
    const result = computeFifoRealizedPnl([lot({ id: 'lot-1', costBasisUsd: 100 })], '100', 60);
    expect(result.matches[0]!.realizedPnlUsd).toBe(-40);
  });

  it('produces no matches and no proceeds for a sell with zero open lots', () => {
    const result = computeFifoRealizedPnl([], '50', 25);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedQuantityRaw).toBe('50');
  });
});

describe('toPnlWindowStats', () => {
  it('returns null pnl/pct (never a fabricated 0) when nothing was matched in the window', () => {
    const stats = toPnlWindowStats('24h', { realizedPnlUsd: 0, costBasisUsd: 0, proceedsUsd: 0, matchedCount: 0 });
    expect(stats).toEqual({ window: '24h', realizedPnlUsd: null, realizedPnlPct: null, volumeUsd: 0 });
  });

  it('computes a real percentage return against the matched cost basis', () => {
    const stats = toPnlWindowStats('7d', { realizedPnlUsd: 25, costBasisUsd: 100, proceedsUsd: 125, matchedCount: 3 });
    expect(stats.realizedPnlUsd).toBe(25);
    expect(stats.realizedPnlPct).toBe(25);
    expect(stats.volumeUsd).toBe(225);
  });

  it('returns a null percentage (not a divide-by-zero artifact) when matched but cost basis is exactly zero', () => {
    const stats = toPnlWindowStats('30d', { realizedPnlUsd: 10, costBasisUsd: 0, proceedsUsd: 10, matchedCount: 1 });
    expect(stats.realizedPnlPct).toBeNull();
  });

  it('reports a real negative pnl/pct honestly', () => {
    const stats = toPnlWindowStats('24h', { realizedPnlUsd: -50, costBasisUsd: 100, proceedsUsd: 50, matchedCount: 2 });
    expect(stats.realizedPnlUsd).toBe(-50);
    expect(stats.realizedPnlPct).toBe(-50);
  });
});

describe('PNL_WINDOW_MS', () => {
  it('defines all three windows in ascending order', () => {
    expect(PNL_WINDOW_MS['24h']).toBeLessThan(PNL_WINDOW_MS['7d']);
    expect(PNL_WINDOW_MS['7d']).toBeLessThan(PNL_WINDOW_MS['30d']);
    expect(PNL_WINDOW_MS['24h']).toBe(24 * 60 * 60 * 1000);
  });
});
