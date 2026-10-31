import type { NewsItem } from '@kamby/domain';
import { pageFromLatest } from './news.service';

const BONK = { symbol: 'BONK', chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' };
const WETH = { symbol: 'ETH', chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006' };
const item = (n: number, tokens: NewsItem['tokens'] = []): NewsItem => ({
  id: `id${n}`,
  sourceId: 'decrypt',
  title: `Story ${n}`,
  summary: '',
  url: `https://decrypt.co/${n}`,
  publishedAt: new Date(Date.UTC(2026, 9, 31, 12, 60 - n)).toISOString(),
  tokens,
});

describe('pageFromLatest', () => {
  const latest = [item(1, [BONK]), item(2), item(3, [WETH]), item(4, [BONK])];

  it('pages newest first with a cursor', () => {
    const first = pageFromLatest(latest, { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['id1', 'id2']);
    const second = pageFromLatest(latest, { limit: 2, before: first.nextBefore! });
    expect(second.items.map((i) => i.id)).toEqual(['id3', 'id4']);
    expect(second.nextBefore).toBeNull();
  });

  it("filters to one coin by chain + address (EVM in any casing)", () => {
    expect(pageFromLatest(latest, { limit: 10, tokenKey: 'solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }).items.map((i) => i.id)).toEqual(['id1', 'id4']);
    expect(pageFromLatest(latest, { limit: 10, tokenKey: 'eip155:8453:0x4200000000000000000000000000000000000006' }).items.map((i) => i.id)).toEqual(['id3']);
  });
});
