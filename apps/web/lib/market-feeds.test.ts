import { describe, expect, it } from 'vitest';
import { emptyMarketFeeds, type PumpFunTokenSummary } from '@kamby/domain';
import { applyFeedEvent, applyPumpFunBatch } from './market-feeds';

const NOW = Date.parse('2026-09-30T12:00:00Z');

function curve(mint: string, overrides: Partial<PumpFunTokenSummary> = {}): PumpFunTokenSummary {
  return {
    mintAddress: mint,
    name: mint,
    symbol: mint,
    uri: null,
    virtualSolReserves: '40000000000',
    virtualTokenReserves: '800000000000000',
    realSolReserves: '10000000000',
    realTokenReserves: '520000000000000',
    tokenTotalSupply: '1000000000000000',
    graduationProgressPct: 10,
    complete: false,
    createdAt: new Date(NOW - 60_000).toISOString(),
    graduatedAt: null,
    ...overrides,
  };
}

function state(trenches: PumpFunTokenSummary[], bonding: PumpFunTokenSummary[] = []) {
  const base = emptyMarketFeeds();
  return { ...base, trenches: { ...base.trenches, tokens: trenches }, bonding: { ...base.bonding, tokens: bonding } };
}

describe('applyPumpFunBatch', () => {
  it('updates a listed coin in place — its progress bar moves', () => {
    const next = applyPumpFunBatch(state([curve('A'), curve('B')]), { tokens: [curve('B', { graduationProgressPct: 42 })], atIso: '' }, NOW);
    expect(next.trenches.tokens.map((t) => [t.mintAddress, t.graduationProgressPct])).toEqual([['A', 10], ['B', 42]]);
  });

  it('puts a brand-new launch at the top of Trenches, but not an old curve that merely traded', () => {
    const next = applyPumpFunBatch(
      state([curve('A')]),
      { tokens: [curve('NEW'), curve('OLD', { createdAt: new Date(NOW - 3 * 60 * 60_000).toISOString() })], atIso: '' },
      NOW,
    );
    expect(next.trenches.tokens.map((t) => t.mintAddress)).toEqual(['NEW', 'A']);
  });

  it('keeps Bonding ordered by progress as curves fill', () => {
    const next = applyPumpFunBatch(state([], [curve('X', { graduationProgressPct: 90 }), curve('Y', { graduationProgressPct: 80 })]), { tokens: [curve('Y', { graduationProgressPct: 95 })], atIso: '' }, NOW);
    expect(next.bonding.tokens.map((t) => t.mintAddress)).toEqual(['Y', 'X']);
  });

  it('moves a coin that graduates out of Trenches/Bonding and into Graduated', () => {
    const next = applyPumpFunBatch(state([curve('G')], [curve('G')]), { tokens: [curve('G', { complete: true, graduatedAt: new Date(NOW).toISOString() })], atIso: '' }, NOW);
    expect(next.trenches.tokens).toEqual([]);
    expect(next.bonding.tokens).toEqual([]);
    expect(next.graduated.pumpfun.map((t) => t.mintAddress)).toEqual(['G']);
  });
});

describe('applyFeedEvent', () => {
  it('replaces a tab wholesale on its snapshot event and ignores unknown events', () => {
    const start = emptyMarketFeeds();
    const crypto = { prices: [{ symbol: 'BTC' as const, priceUsd: 84_000, change24hPct: null, updatedAtIso: '' }], atIso: 'x' };
    expect(applyFeedEvent(start, 'crypto', crypto).crypto).toBe(crypto);
    expect(applyFeedEvent(start, 'heartbeat', {})).toBe(start);
  });
});
