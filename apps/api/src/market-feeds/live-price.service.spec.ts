import { pricesFromPairs } from './live-price.service';

describe('pricesFromPairs', () => {
  it('uses only pairs where the coin is the base token, the deepest one winning', () => {
    const prices = pricesFromPairs(
      [
        { baseToken: { address: '0xAAA' }, priceUsd: '2.5', liquidity: { usd: 1_000 } },
        { baseToken: { address: '0xaaa' }, priceUsd: '2.6', liquidity: { usd: 50_000 } },
        { baseToken: { address: '0xBBB' }, priceUsd: 'not-a-number', liquidity: { usd: 9 } },
        { baseToken: { address: '0xCCC' }, priceUsd: '0', liquidity: { usd: 9 } },
      ],
      'base',
    );
    expect(prices.get('0xaaa')).toBe(2.6);
    expect(prices.has('0xbbb')).toBe(false);
    expect(prices.has('0xccc')).toBe(false);
  });

  it('keeps Solana mints case-sensitive', () => {
    const prices = pricesFromPairs([{ baseToken: { address: 'DezXAZ8z' }, priceUsd: '0.00000377' }], 'solana');
    expect(prices.get('DezXAZ8z')).toBe(0.00000377);
    expect(prices.has('dezxaz8z')).toBe(false);
  });
});
