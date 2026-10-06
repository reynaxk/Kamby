import type { MarketSummary, TrendingToken } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { pickDefaultMarket } from './default-market';

const WETH = '0x4200000000000000000000000000000000000006';
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';

function market(tokenAddress: string, chainIdentifier = 'eip155:8453'): MarketSummary {
  return { chainIdentifier, tokenAddress, symbol: tokenAddress.slice(2, 6) } as MarketSummary;
}
function trending(...markets: MarketSummary[]): TrendingToken[] {
  return markets.map((m) => ({ market: m }) as TrendingToken);
}

// Pool-discovered — not on the seed list, e.g. a wash-traded token trending on fake volume.
const discovered = market('0x07b3000000000000000000000000000000009100');
const solana = market('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'solana');

describe('pickDefaultMarket', () => {
  const hot = (addr: string, overrides: Partial<MarketSummary> = {}) =>
    ({ ...market(addr), priceUsd: 0.01, liquidityUsd: 50_000, volume24hUsd: 20_000, isStale: false, ...overrides }) as MarketSummary;

  it('opens on a random hot Trending coin — not only the hand-picked majors', () => {
    const list = [hot('0xa1'), hot('0xb2'), hot('0xc3')];
    expect(pickDefaultMarket(list, [], () => 0)?.tokenAddress).toBe('0xa1');
    expect(pickDefaultMarket(list, [], () => 0.99)?.tokenAddress).toBe('0xc3');
  });

  it('skips coins without real depth, trading or a fresh price', () => {
    const list = [hot('0xthin', { liquidityUsd: 5_000 }), hot('0xdead', { volume24hUsd: 100 }), hot('0xstale', { isStale: true }), hot('0xok')];
    expect(pickDefaultMarket(list, [], () => 0)?.tokenAddress).toBe('0xok');
  });

  it('never picks a pool-discovered token without real depth, even when it tops trending', () => {
    const picks = [0, 0.5, 0.99].map((r) => pickDefaultMarket([], trending(discovered, market(WETH)), () => r));
    expect(picks.every((m) => m?.tokenAddress === WETH)).toBe(true);
  });

  it('picks randomly among curated trending markets', () => {
    const t = trending(market(WETH), market(CBBTC));
    expect(pickDefaultMarket([], t, () => 0)?.tokenAddress).toBe(WETH);
    expect(pickDefaultMarket([], t, () => 0.99)?.tokenAddress).toBe(CBBTC);
  });

  it('matches curated addresses case-insensitively', () => {
    expect(pickDefaultMarket([], trending(market(CBBTC.toLowerCase())), () => 0)).toBeDefined();
  });

  it('never picks a non-EVM (Solana) market', () => {
    expect(pickDefaultMarket([solana], trending(solana), () => 0)).toBeUndefined();
  });

  it('falls back to the top-ranked curated market when nothing curated is trending', () => {
    expect(pickDefaultMarket([discovered, market(CBBTC)], trending(discovered), () => 0)?.tokenAddress).toBe(CBBTC);
  });

  it('falls back to any selectable market rather than showing nothing', () => {
    expect(pickDefaultMarket([solana, discovered], [], () => 0)).toBe(discovered);
  });
});
