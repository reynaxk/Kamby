import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { MarketInfoPanel } from './MarketInfoPanel';

function market(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'eip155:8453',
    tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    symbol: 'KAM',
    name: 'Kamby Token',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'USDC',
    quoteAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    quoteDecimals: 6,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 1.25,
    liquidityUsd: 50_000,
    volume24hUsd: 12_500,
    priceChange24hPct: 4,
    marketCapUsd: 2_500_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('MarketInfoPanel', () => {
  it('renders real market facts and a copyable contract address', () => {
    render(<MarketInfoPanel market={market()} />);

    expect(screen.getByText('About $KAM')).toBeInTheDocument();
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.getByText('$1.25')).toBeInTheDocument();
    expect(screen.getByText('$2.50M')).toBeInTheDocument();
    expect(screen.getByText('uniswap-v3')).toBeInTheDocument();
    expect(screen.getByText('0xaaaa…aaaa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('does not invent nullable market facts', () => {
    render(
      <MarketInfoPanel
        market={market({
          symbol: null,
          name: null,
          priceUsd: null,
          marketCapUsd: null,
          liquidityUsd: null,
          volume24hUsd: null,
          dex: null,
          quoteSymbol: null,
        })}
      />,
    );

    expect(screen.getByText('About $Token')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });
});
