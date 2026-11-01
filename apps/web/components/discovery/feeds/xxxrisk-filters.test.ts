import { describe, expect, it } from 'vitest';
import type { XxxRiskToken } from '@kamby/domain';
import { NO_FILTERS, activeCount, passes, readColumnFilters } from './xxxrisk-filters';

const coin = (patch: Partial<XxxRiskToken> = {}): XxxRiskToken => ({
  mintAddress: 'm',
  symbol: 'X',
  name: 'X',
  imageUrl: null,
  ageSeconds: 120,
  liquidityUsd: 5_000,
  marketCapUsd: 20_000,
  volume5mUsd: 1_000,
  traders5m: 10,
  riskFlags: [],
  launchpad: 'letsbonk.fun',
  holders: 40,
  ...patch,
});

describe('launchpad board filters', () => {
  it('filters by launchpad, ranges and ticks — an unknown number fails a set range', () => {
    expect(passes(coin(), NO_FILTERS, 120)).toBe(true);
    expect(passes(coin(), { ...NO_FILTERS, launchpads: ['pump.fun'] }, 120)).toBe(false);
    expect(passes(coin(), { ...NO_FILTERS, launchpads: ['none'] }, 120)).toBe(false);
    expect(passes(coin(), { ...NO_FILTERS, ranges: { mc: { min: 10_000, max: 30_000 } } }, 120)).toBe(true);
    expect(passes(coin(), { ...NO_FILTERS, ranges: { age: { min: null, max: 1 } } }, 120)).toBe(false);
    expect(passes(coin({ snipersPct: null }), { ...NO_FILTERS, ranges: { snipers: { min: null, max: 10 } } }, 120)).toBe(false);
    expect(passes(coin(), { ...NO_FILTERS, toggles: { hasX: true } }, 120)).toBe(false);
    expect(passes(coin({ socials: { twitter: 'https://x.com/a' } }), { ...NO_FILTERS, toggles: { hasX: true } }, 120)).toBe(true);
    expect(activeCount({ launchpads: ['pump.fun'], ranges: { mc: { min: 1, max: null }, liq: { min: null, max: null } }, toggles: { hasX: true, hideMint: false } })).toBe(3);
  });

  it('starts old flat saved views clean', () => {
    expect(readColumnFilters({ maxAgeMin: 3 })).toEqual({ new: NO_FILTERS, soon: NO_FILTERS, migrated: NO_FILTERS });
  });
});
