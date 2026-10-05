import { curvePriceUsd, pricesFromPairs } from './live-price.service';

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

describe('curvePriceUsd', () => {
  it("prices a Pump.fun coin from its bonding curve: SOL per token × SOL's price", () => {
    // A fresh curve: 30 virtual SOL against 1,073,000,000 virtual tokens, SOL at $150.
    expect(curvePriceUsd('30000000000', '1073000000000000', 150)).toBeCloseTo((30 / 1_073_000_000) * 150, 12);
  });

  it('never invents a price from empty reserves or an unknown SOL price', () => {
    expect(curvePriceUsd('0', '1073000000000000', 150)).toBeNull();
    expect(curvePriceUsd('30000000000', '0', 150)).toBeNull();
    expect(curvePriceUsd('30000000000', '1073000000000000', 0)).toBeNull();
  });
});
