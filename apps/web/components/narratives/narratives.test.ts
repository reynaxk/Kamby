import type { NarrativeSummary, NarrativesSnapshot } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { filterByNarrative } from './NarrativePills';
import { applyNarrativeFilter } from './NarrativesView';

const coin = (symbol: string, tokenAddress: string, chainIdentifier = 'eip155:8453') => ({ symbol, name: symbol, tokenAddress, chainIdentifier });

describe('narrative pills', () => {
  it('keeps one narrative and sorts its coins by heat', () => {
    const rows = [coin('AGENT', '0xa'), coin('QWE', '0xq'), coin('ROBOAI', '0xr')];
    const snapshot = { narratives: [{ id: 'ai-agents', tokens: [{ chainIdentifier: 'eip155:8453', tokenAddress: '0xR', heat: 90 }, { chainIdentifier: 'eip155:8453', tokenAddress: '0xa', heat: 20 }] }], atIso: '' } as unknown as NarrativesSnapshot;
    expect(filterByNarrative(rows, 'ai-agents', (r) => r, snapshot).map((r) => r.symbol)).toEqual(['ROBOAI', 'AGENT']);
    expect(filterByNarrative(rows, null, (r) => r, snapshot)).toHaveLength(3);
  });
});

describe('narrative filters', () => {
  const n = (id: string, heat: number, liquidityUsd: number, live = 0) => ({ id, heat, liquidityUsd, live: Array.from({ length: live }) }) as unknown as NarrativeSummary;
  const list = [n('a', 91, 5e6), n('b', 40, 2e5, 1), n('c', 82, 1e5)];
  it('filters superheated, live and liquid', () => {
    expect(applyNarrativeFilter(list, 'superheated').map((x) => x.id)).toEqual(['a', 'c']);
    expect(applyNarrativeFilter(list, 'live').map((x) => x.id)).toEqual(['b']);
    expect(applyNarrativeFilter(list, 'liquid').map((x) => x.id)).toEqual(['a']);
    expect(applyNarrativeFilter(list, 'all')).toHaveLength(3);
  });
});
