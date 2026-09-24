import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { TokenCard } from './TokenCard';

function fakeMarket(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'eip155:8453',
    tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    symbol: 'FOO',
    name: 'Foo Token',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'WETH',
    quoteAddress: '0xquote',
    quoteDecimals: 18,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 2.5,
    liquidityUsd: 75_000,
    volume24hUsd: 500_000,
    priceChange24hPct: -2,
    marketCapUsd: 1_000_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('TokenCard', () => {
  it('links a Base-chain token to its real chain-scoped URL', () => {
    render(<TokenCard market={fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' })} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain token to its own real chain-scoped URL, not defaulting to Base', () => {
    render(<TokenCard market={fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' })} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/bnb/0xbbb');
  });

  it('falls back to the default chain slug rather than crashing for an unrecognized chain identifier', () => {
    render(<TokenCard market={fakeMarket({ chainIdentifier: 'eip155:999999', tokenAddress: '0xccc' })} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/base/0xccc');
  });

  it('shows the stale badge only when the market data is actually stale', () => {
    const { rerender } = render(<TokenCard market={fakeMarket({ isStale: false })} />);
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();

    rerender(<TokenCard market={fakeMarket({ isStale: true })} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('shows the real price, volume, and liquidity for this specific market', () => {
    render(<TokenCard market={fakeMarket({ priceUsd: 2.5, volume24hUsd: 500_000, liquidityUsd: 75_000 })} />);
    expect(screen.getByText('$2.50')).toBeInTheDocument();
    expect(screen.getByText('$500.0K')).toBeInTheDocument();
    expect(screen.getByText('$75.0K')).toBeInTheDocument();
  });
});
