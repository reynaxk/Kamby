import { describe, expect, it } from 'vitest';
import { pickChartPair, pickSanePair, SOLANA_STANDARD_QUOTE_MINTS } from './pair-sanity';

const SOL = 'So11111111111111111111111111111111111111112';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('pickSanePair', () => {
  it("ignores a deep but mispriced pool (the real JUP case: JUP/BONK at $5,134 vs JUP/SOL at $0.32)", () => {
    const best = pickSanePair(
      [
        { priceUsd: 5134.55, liquidityUsd: 5_357_626, quoteAddress: BONK },
        { priceUsd: 0.3198, liquidityUsd: 2_257_792, quoteAddress: SOL },
        { priceUsd: 0.3197, liquidityUsd: 820_157, quoteAddress: SOL },
      ],
      SOLANA_STANDARD_QUOTE_MINTS,
    );
    expect(best?.priceUsd).toBe(0.3198);
  });

  it('still drops an outlier among standard-quoted pools, and works without quote info', () => {
    expect(pickSanePair([{ priceUsd: 10, liquidityUsd: 9e6 }, { priceUsd: 1, liquidityUsd: 1e6 }, { priceUsd: 1.01, liquidityUsd: 5e5 }])?.priceUsd).toBe(1);
    expect(pickSanePair([])).toBeNull();
  });
});

describe('pickChartPair', () => {
  const p = (pairAddress: string, priceUsd: number, liquidityUsd: number) => ({ pairAddress, priceUsd, liquidityUsd });

  it("follows the coin's chart pool, so Live and the candles show one market", () => {
    expect(pickChartPair([p('DEEP', 1.0, 900), p('CHART', 1.04, 100)], 'CHART')?.pairAddress).toBe('CHART');
  });

  it('falls back to the deepest sane pool when the chart pool is missing or mispriced', () => {
    expect(pickChartPair([p('DEEP', 1.0, 900), p('OTHER', 1.01, 500), p('CHART', 5, 100)], 'CHART')?.pairAddress).toBe('DEEP');
    expect(pickChartPair([p('DEEP', 1.0, 900)], 'GONE')?.pairAddress).toBe('DEEP');
    expect(pickChartPair([p('DEEP', 1.0, 900)], undefined)?.pairAddress).toBe('DEEP');
  });
});
