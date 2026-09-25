import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { SelectableTokenRow } from './SelectableTokenRow';

function fakeMarket(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'base',
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
    priceUsd: 1,
    liquidityUsd: 50_000,
    volume24hUsd: 10_000,
    priceChange24hPct: 5,
    marketCapUsd: 1_500_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('SelectableTokenRow', () => {
  it('calls onSelect with the real, full market object on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const market = fakeMarket();
    render(<SelectableTokenRow market={market} selected={false} onSelect={onSelect} />);

    await user.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith(market);
  });

  it('reflects selection via aria-pressed, not just visual styling', () => {
    render(<SelectableTokenRow market={fakeMarket()} selected onSelect={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is a real disabled button when disabled, not just dimmed styling', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SelectableTokenRow market={fakeMarket()} selected={false} onSelect={onSelect} disabled />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never dims the currently-selected row even while disabled — only other rows should look blocked', () => {
    // A real, deliberate distinction: DiscoverTerminal disables row-switching while a trade
    // is in flight, but the row that's already selected (the one actually mid-trade) must
    // not look "blocked" itself — only the *other* rows a user might switch away to.
    render(<SelectableTokenRow market={fakeMarket()} selected disabled onSelect={vi.fn()} />);
    expect(screen.getByRole('button')).not.toHaveClass('opacity-50');
  });

  it('dims a disabled row that is not the current selection', () => {
    render(<SelectableTokenRow market={fakeMarket()} selected={false} disabled onSelect={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('opacity-50', 'cursor-not-allowed');
  });

  it('shows real compact market cap and percent change text', () => {
    render(<SelectableTokenRow market={fakeMarket({ marketCapUsd: 1_500_000, priceChange24hPct: 5 })} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText('$1.50M MC')).toBeInTheDocument();
    expect(screen.getByText('+5.00%')).toBeInTheDocument();
  });

  it('colors a real negative change down', () => {
    render(<SelectableTokenRow market={fakeMarket({ priceChange24hPct: -3 })} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText('-3.00%')).toHaveClass('text-down');
  });

  it('treats an unknown (null) 24h change as up, not down — defaults never invent a loss', () => {
    render(<SelectableTokenRow market={fakeMarket({ priceChange24hPct: null })} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText('—')).toHaveClass('text-up');
  });

  it('renders a real image for the avatar when the market has a real logoUrl, instead of the initial fallback', () => {
    const { container } = render(
      <SelectableTokenRow market={fakeMarket({ symbol: 'FOO', logoUrl: 'https://cdn.dexscreener.com/real-logo.png' })} selected={false} onSelect={vi.fn()} />,
    );

    // alt="" deliberately (matching TokenIdentity.tsx's own pattern) marks this decorative
    // for accessibility purposes, so it has no "img" role to query by — a plain CSS query
    // is the right tool here, not getByRole.
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cdn.dexscreener.com/real-logo.png');
    expect(screen.queryByText('F')).not.toBeInTheDocument(); // the initial-avatar fallback must not also render
  });

  it('falls back to the initial-avatar when logoUrl is null, never a broken/empty image tag', () => {
    const { container } = render(<SelectableTokenRow market={fakeMarket({ symbol: 'FOO', logoUrl: null })} selected={false} onSelect={vi.fn()} />);

    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });

  it('falls back to the address when there is no symbol, for both the label and the avatar initial', () => {
    render(
      <SelectableTokenRow
        market={fakeMarket({ symbol: null, tokenAddress: '0xbeef000000000000000000000000000000dead' })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('$0xbeef')).toBeInTheDocument();
    // The avatar initial is the *very first* character of the fallback string — for any
    // symbol-less EVM address that's always literally "0" (from the "0x" prefix), not a
    // meaningful per-token initial. That's the real, current behavior, not a typo.
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
