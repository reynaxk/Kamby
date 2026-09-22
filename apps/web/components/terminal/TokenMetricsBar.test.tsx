import { render, screen } from '@testing-library/react';
import { DISCOVERY_RANKING, type MarketSummary } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { TokenMetricsBar } from './TokenMetricsBar';

function market(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'base',
    tokenAddress: '0xabc',
    symbol: 'PEPE',
    name: 'Pepe',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'WETH',
    quoteAddress: '0xquote',
    quoteDecimals: 18,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 1,
    liquidityUsd: 50_000,
    volume24hUsd: 10_000,
    priceChange24hPct: 5,
    marketCapUsd: 1_000_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('TokenMetricsBar', () => {
  it('shows no low-liquidity badge for a market well above the trading threshold', () => {
    render(<TokenMetricsBar market={market({ liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd * 10 })} />);
    expect(screen.queryByText('Low liquidity')).not.toBeInTheDocument();
  });

  // Same threshold SafetyService.assertTradable actually enforces server-side — a trade on
  // a market this thin gets rejected the moment it's attempted; this badge exists so that's
  // known before filling out the form, not discovered as a failed submission.
  it('shows the low-liquidity badge once liquidity drops below the real backend trading threshold', () => {
    render(<TokenMetricsBar market={market({ liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd - 1 })} />);
    expect(screen.getByText('Low liquidity')).toBeInTheDocument();
  });

  it('shows the low-liquidity badge when liquidity is unknown (null), not just when it is low', () => {
    render(<TokenMetricsBar market={market({ liquidityUsd: null })} />);
    expect(screen.getByText('Low liquidity')).toBeInTheDocument();
  });
});
