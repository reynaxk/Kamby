import type { MarketSummary } from '@kamby/domain';
import { hideLookalikes } from './lookalike-filter';

const BASE = 'eip155:8453';
const REAL_AAVE = '0x63706e401c06ac8513145b7687A14804d17f814b'; // on the Base seed list

function market(overrides: Partial<MarketSummary>): MarketSummary {
  return {
    chainIdentifier: BASE,
    tokenAddress: '0x0000000000000000000000000000000000000001',
    symbol: 'FOO',
    name: 'Foo',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'WETH',
    quoteAddress: '0x4200000000000000000000000000000000000006',
    quoteDecimals: 18,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 1,
    liquidityUsd: 100_000,
    volume24hUsd: 1_000,
    priceChange24hPct: 0,
    marketCapUsd: null,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  } as MarketSummary;
}

describe('hideLookalikes', () => {
  it('keeps only the hand-picked token when discovered copies share its ticker — even a copy with far bigger numbers', () => {
    const real = market({ tokenAddress: REAL_AAVE, symbol: 'AAVE', volume24hUsd: 200_000, liquidityUsd: 336_000 });
    const fakeHuge = market({ tokenAddress: '0x82C00eCaD648d417244E0AE39DE0A3AF6D9E438a', symbol: 'AAVE', volume24hUsd: 12_000_000, liquidityUsd: 1_137_276_927 });
    const fakeSmall = market({ tokenAddress: '0xCFb27E2628D35FbE8D9EF6b2030a5c151641f35a', symbol: 'aave', volume24hUsd: 0 });

    expect(hideLookalikes([fakeHuge, real, fakeSmall])).toEqual([real]);
  });

  it('among discovered-only copies, keeps just the most-traded one', () => {
    const copies = [
      market({ tokenAddress: '0xa1', symbol: 'CETUS', volume24hUsd: 0, liquidityUsd: 16_035 }),
      market({ tokenAddress: '0xa2', symbol: 'CETUS', volume24hUsd: 5_453, liquidityUsd: 160_571 }),
      market({ tokenAddress: '0xa3', symbol: 'CETUS', volume24hUsd: null, liquidityUsd: 900_000 }),
    ];

    expect(hideLookalikes(copies)).toEqual([copies[1]]);
  });

  it('breaks a volume tie on liquidity', () => {
    const a = market({ tokenAddress: '0xa1', symbol: 'ZC', volume24hUsd: 0, liquidityUsd: 2_000 });
    const b = market({ tokenAddress: '0xa2', symbol: 'ZC', volume24hUsd: 0, liquidityUsd: 9_000 });

    expect(hideLookalikes([a, b])).toEqual([b]);
  });

  it('treats "$WIF" and "WIF" as the same ticker', () => {
    const a = market({ tokenAddress: '0xa1', symbol: '$WIF', volume24hUsd: 10 });
    const b = market({ tokenAddress: '0xa2', symbol: 'WIF', volume24hUsd: 20 });

    expect(hideLookalikes([a, b])).toEqual([b]);
  });

  it('never merges the same ticker across chains', () => {
    const onBase = market({ symbol: 'USDT' });
    const onBnb = market({ chainIdentifier: 'eip155:56', symbol: 'USDT' });

    expect(hideLookalikes([onBase, onBnb])).toEqual([onBase, onBnb]);
  });

  it('passes symbol-less markets and distinct tickers through, preserving order', () => {
    const list = [market({ tokenAddress: '0xa1', symbol: 'AAA' }), market({ tokenAddress: '0xa2', symbol: null }), market({ tokenAddress: '0xa3', symbol: 'BBB' })];

    expect(hideLookalikes(list)).toEqual(list);
  });
});
