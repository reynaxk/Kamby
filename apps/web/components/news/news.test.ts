import type { NewsItem } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { pickTickerItem } from './NewsTickerLine';
import { coinKeyFromLocation, toastReason } from './NewsToaster';

const now = Date.parse('2026-10-31T16:00:00Z');
const BONK = { symbol: 'BONK', chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' };
const ETH = { symbol: 'ETH', chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006' };
const item = (id: string, minutesAgo: number, tokens: NewsItem['tokens'] = []): NewsItem => ({
  id, sourceId: 'decrypt', title: id, summary: '', url: `https://decrypt.co/${id}`, publishedAt: new Date(now - minutesAgo * 60_000).toISOString(), tokens,
});

describe('coinKeyFromLocation', () => {
  it('reads the coin from EVM and Solana pages by address', () => {
    expect(coinKeyFromLocation('/market/base/0x4200000000000000000000000000000000000006', '')).toBe('eip155:8453:0x4200000000000000000000000000000000000006');
    expect(coinKeyFromLocation('/solana', `?mint=${BONK.tokenAddress}`)).toBe(`solana:${BONK.tokenAddress}`);
    expect(coinKeyFromLocation('/solana', '')).toBe('solana:So11111111111111111111111111111111111111112');
    expect(coinKeyFromLocation('/home', '')).toBeNull();
  });
});

describe('toastReason', () => {
  it('toasts only for watched coins (first) or the coin on screen', () => {
    const news = item('a', 1, [BONK, ETH]);
    expect(toastReason(news, new Set([`solana:${BONK.tokenAddress}`]), null)).toBe('watchlist');
    expect(toastReason(news, new Set(), 'eip155:8453:0x4200000000000000000000000000000000000006')).toBe('onScreen');
    expect(toastReason(news, new Set(), null)).toBeNull();
    expect(toastReason(item('b', 1), new Set([`solana:${BONK.tokenAddress}`]), null)).toBeNull();
    expect(toastReason(news, new Set([`solana:${BONK.tokenAddress}`]), null, new Set([`solana:${BONK.tokenAddress}`]))).toBe('holding');
  });
});

describe('pickTickerItem', () => {
  it("prefers the coin's own recent headline, else breaking news, else nothing", () => {
    expect(pickTickerItem([item('coin', 600, [BONK])], [item('all', 5)], now)?.id).toBe('coin');
    expect(pickTickerItem([item('coin', 2000, [BONK])], [item('all', 5)], now)?.id).toBe('all');
    expect(pickTickerItem([], [item('all', 400)], now)).toBeNull();
  });
});

describe('feed helpers', () => {
  it('weaves a headline in after every 4 posts', async () => {
    const { mixNews } = await import('@/components/feed/mix-news');
    const posts = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}` }) as never);
    const kinds = mixNews(posts, [item('n1', 1), item('n2', 2), item('n3', 3)]).map((e) => ('post' in e ? 'p' : 'n')).join('');
    expect(kinds).toBe('ppppnppppnp');
  });

  it('only makes verified cashtags tappable', async () => {
    const { splitCashtags } = await import('@/components/feed/FeedCoin');
    const parts = splitCashtags('aped $bonk and $FAKECOIN today');
    expect(parts[0]).toBe('aped ');
    expect(parts[1]).toMatchObject({ symbol: 'BONK', chainIdentifier: 'solana', tokenAddress: BONK.tokenAddress });
    expect(parts[2]).toBe(' and $FAKECOIN today');
  });
});
