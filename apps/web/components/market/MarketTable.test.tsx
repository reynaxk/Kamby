import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { MarketTable } from './MarketTable';

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
    priceUsd: 1.5,
    liquidityUsd: 50_000,
    volume24hUsd: 2_500_000,
    priceChange24hPct: 5,
    marketCapUsd: 1_000_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('MarketTable', () => {
  it('shows a real empty state, not a blank table, for zero markets', () => {
    render(<MarketTable markets={[]} />);
    expect(screen.getByText('No market data available yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('links a Base-chain token to its real chain-scoped URL', () => {
    render(<MarketTable markets={[fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' })]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain token to its own real chain-scoped URL, not defaulting to Base', () => {
    render(<MarketTable markets={[fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' })]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/bnb/0xbbb');
  });

  it('shows the stale badge only for a market whose price data is actually stale', () => {
    render(
      <MarketTable
        markets={[fakeMarket({ tokenAddress: '0xaaa', isStale: false }), fakeMarket({ tokenAddress: '0xbbb', isStale: true })]}
      />,
    );
    expect(screen.getAllByText('Stale')).toHaveLength(1);
  });

  it('wires each row to its own real market data, not a shared/stale value across rows', () => {
    render(
      <MarketTable
        markets={[
          fakeMarket({ tokenAddress: '0xaaa', symbol: 'FIRST', priceUsd: 1, volume24hUsd: 100 }),
          fakeMarket({ tokenAddress: '0xbbb', symbol: 'SECOND', priceUsd: 2, volume24hUsd: 200 }),
        ]}
      />,
    );
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    expect(screen.getByText('SECOND')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
  });
});
