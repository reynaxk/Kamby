import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { CellTokenSelector } from './CellTokenSelector';

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

describe('CellTokenSelector', () => {
  it('shows a real placeholder option only when nothing is selected yet', () => {
    render(<CellTokenSelector availableMarkets={[fakeMarket()]} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'Pick a token…' })).toBeInTheDocument();
  });

  it('never shows the placeholder option once a real token is selected', () => {
    const market = fakeMarket();
    render(<CellTokenSelector availableMarkets={[market]} selected={market} onSelect={vi.fn()} />);

    expect(screen.queryByRole('option', { name: 'Pick a token…' })).not.toBeInTheDocument();
  });

  it("reflects the real selected market's own composite chain+address key as the select value", () => {
    const market = fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' });
    render(<CellTokenSelector availableMarkets={[market]} selected={market} onSelect={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveValue('eip155:56:0xbbb');
  });

  it('labels each real option with its symbol, falling back to a truncated address when symbol-less', () => {
    render(
      <CellTokenSelector
        availableMarkets={[fakeMarket({ symbol: 'FOO' }), fakeMarket({ symbol: null, tokenAddress: '0xabcdefabcdef' })]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: '$FOO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '$0xabcd' })).toBeInTheDocument(); // first 6 chars
  });

  it('calls onSelect with the real matching market when a new option is chosen', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const marketA = fakeMarket({ symbol: 'AAA', tokenAddress: '0xaaa' });
    const marketB = fakeMarket({ symbol: 'BBB', tokenAddress: '0xbbb' });
    render(<CellTokenSelector availableMarkets={[marketA, marketB]} selected={marketA} onSelect={onSelect} />);

    await user.selectOptions(screen.getByRole('combobox'), '$BBB');

    expect(onSelect).toHaveBeenCalledWith(marketB);
  });

  it('is a controlled component — the DOM value only ever reflects the real selected prop, never an internal choice', async () => {
    const user = userEvent.setup();
    const marketA = fakeMarket({ symbol: 'AAA', tokenAddress: '0xaaa' });
    const marketB = fakeMarket({ symbol: 'BBB', tokenAddress: '0xbbb' });
    // onSelect deliberately does nothing — the parent never updates `selected`.
    render(<CellTokenSelector availableMarkets={[marketA, marketB]} selected={marketA} onSelect={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), '$BBB');

    expect(screen.getByRole('combobox')).toHaveValue('eip155:8453:0xaaa'); // still A — the parent owns the real state
  });

  it('passes the real disabled prop through to the underlying select', () => {
    render(<CellTokenSelector availableMarkets={[fakeMarket()]} selected={null} onSelect={vi.fn()} disabled />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
