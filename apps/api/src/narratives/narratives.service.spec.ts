import { NARRATIVES, heatIndex, heatTier, narrativesOf } from '@kamby/domain';
import { summarize, tokenFromPairs } from './narratives.service';

const BONK = { chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', logoUrl: null };

describe('narratives', () => {
  it('tags verified coins, launch rules and keywords — never a coin that matches nothing', () => {
    expect(narrativesOf(BONK)).toEqual(expect.arrayContaining(['solana-memes', 'dogs']));
    expect(narrativesOf({ chainIdentifier: 'solana', tokenAddress: 'Abc123pump', symbol: 'ZZZ', name: 'Zzz' })).toEqual(['solana-memes']);
    expect(narrativesOf({ chainIdentifier: 'eip155:8453', tokenAddress: '0xabc', symbol: 'AGENTX', name: 'Agent X AI' })).toContain('ai-agents');
    expect(narrativesOf({ chainIdentifier: 'eip155:8453', tokenAddress: '0xabc', symbol: 'QWE', name: 'Qwerty' })).toEqual([]);
  });

  it("reads a coin's own deepest pool", () => {
    const token = tokenFromPairs(BONK, [
      { baseToken: { address: BONK.tokenAddress }, priceUsd: '0.00002', liquidity: { usd: 100 }, volume: { h1: 1, h24: 24 } },
      { baseToken: { address: BONK.tokenAddress }, priceUsd: '0.000021', liquidity: { usd: 5_000_000 }, volume: { h1: 300_000, h24: 2_400_000 }, priceChange: { m5: 0.1, h1: 2, h6: 5, h24: 10 }, marketCap: 1.6e9 },
      { baseToken: { address: 'other' }, priceUsd: '9', liquidity: { usd: 9e9 } },
    ])!;
    expect(token.priceUsd).toBe(0.000021);
    expect(token.volume1hUsd).toBe(300_000);
    expect(token.spark).toHaveLength(5);
    expect(token.heat).toBeGreaterThan(50); // 1h volume is 3x a normal hour
  });

  it('scores heat from the signals that have data, and tiers it', () => {
    const def = NARRATIVES.find((n) => n.id === 'dogs')!;
    const busy = summarize(def, [{ ...BONK, priceUsd: 1, change1hPct: 1, change24hPct: 5, volume1hUsd: 400, volume24hUsd: 2400, liquidityUsd: 1e6, marketCapUsd: 1e7, spark: [], heat: 60 }], {
      kambyTrades1h: 0,
      leaderNetBuys: 0,
      live: [],
    });
    expect(busy.signals.volumeAcceleration).toBeCloseTo(4);
    // Nobody on Kamby is trading or streaming: only volume counts, and 4x a normal hour is full heat.
    const heat = heatIndex(busy.signals, { volume: true, kamby: false, live: false, leaders: false });
    expect(heat).toBe(100);
    expect(heatTier(heat)).toBe('superheated');
    expect(heatIndex(busy.signals, { volume: true, kamby: true, live: false, leaders: false })).toBeLessThan(100);
  });
});
