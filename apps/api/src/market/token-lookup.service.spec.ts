import { bestOwnPair, unsafe } from './token-lookup.service';

const COIN = '0x36b712A629095234F2196BbB000D1b96C12Ce78e';

describe('TokenLookupService helpers', () => {
  it('picks the deepest pool that lists the coin itself, on a chain Kamby trades', () => {
    const pairs = [
      { chainId: 'base', pairAddress: '0xa', baseToken: { address: COIN.toLowerCase() }, priceUsd: '0.01', liquidity: { usd: 5_000 } },
      { chainId: 'base', pairAddress: '0xb', baseToken: { address: COIN }, priceUsd: '0.0101', liquidity: { usd: 80_000 } },
      // the coin as the quote side, and an unsupported chain — never picked
      { chainId: 'base', pairAddress: '0xc', baseToken: { address: '0xother' }, quoteToken: { address: COIN }, priceUsd: '5', liquidity: { usd: 900_000 } },
      { chainId: 'ethereum', pairAddress: '0xd', baseToken: { address: COIN }, priceUsd: '0.01', liquidity: { usd: 2_000_000 } },
    ];
    expect(bestOwnPair(pairs, COIN, (c) => c === 'base')?.pairAddress).toBe('0xb');
    expect(bestOwnPair(pairs, COIN, (c) => c === 'bsc')).toBeNull();
  });

  it('rules out honeypots, high taxes and coins with no security verdict', () => {
    expect(unsafe(undefined)).toBe(true);
    expect(unsafe({ is_honeypot: '1' })).toBe(true);
    expect(unsafe({ sell_tax: '0.25' })).toBe(true);
    expect(unsafe({ is_honeypot: '0', buy_tax: '0', sell_tax: '0.03' })).toBe(false);
  });
});
