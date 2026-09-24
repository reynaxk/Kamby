import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MarketSummary, TrendingToken } from '@kamby/domain';
import { DiscoverTokenList } from './DiscoverTokenList';

// TrenchesPanel/LeaderboardSidebar/TradersSidebar/SelectableTokenRow all have their own
// separate coverage — mocked here so this file only exercises DiscoverTokenList's own
// tab-routing and per-tab data-source mapping.
vi.mock('@/components/terminal/TrenchesPanel', () => ({ TrenchesPanel: () => <div>TrenchesPanel</div> }));
vi.mock('./LeaderboardSidebar', () => ({ LeaderboardSidebar: () => <div>LeaderboardSidebar</div> }));
vi.mock('./TradersSidebar', () => ({ TradersSidebar: () => <div>TradersSidebar</div> }));
vi.mock('./SelectableTokenRow', () => ({
  SelectableTokenRow: ({ market, selected, disabled }: { market: MarketSummary; selected: boolean; disabled: boolean }) => (
    <div>
      {market.symbol} {selected ? '(selected)' : ''} {disabled ? '(disabled)' : ''}
    </div>
  ),
}));

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

const defaultProps = {
  ranked: [],
  trending: [] as TrendingToken[],
  movers: [],
  byVolume: [],
  selectedKey: null,
  onSelect: vi.fn(),
  selectionDisabled: false,
};

describe('DiscoverTokenList', () => {
  it('defaults to the Markets tab, showing the real ranked list', () => {
    render(<DiscoverTokenList {...defaultProps} ranked={[fakeMarket({ symbol: 'AAA' })]} />);

    expect(screen.getByText(/AAA/)).toBeInTheDocument();
  });

  it('shows the real trending list, unwrapped from its own trendingScore, under the Trending tab', async () => {
    const user = userEvent.setup();
    const trending: TrendingToken[] = [{ market: fakeMarket({ symbol: 'HOT' }), trendingScore: 9.5 }];
    render(<DiscoverTokenList {...defaultProps} trending={trending} />);

    await user.click(screen.getByRole('button', { name: 'Trending' }));

    expect(screen.getByText(/HOT/)).toBeInTheDocument();
  });

  it('shows the real movers list under the Movers tab', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} movers={[fakeMarket({ symbol: 'MOVE' })]} />);

    await user.click(screen.getByRole('button', { name: 'Movers' }));

    expect(screen.getByText(/MOVE/)).toBeInTheDocument();
  });

  it('shows the real byVolume list under the Volume tab', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} byVolume={[fakeMarket({ symbol: 'VOL' })]} />);

    await user.click(screen.getByRole('button', { name: 'Volume' }));

    expect(screen.getByText(/VOL/)).toBeInTheDocument();
  });

  it('shows a real distinct "nothing here yet" message for an empty list tab, not a blank panel', () => {
    render(<DiscoverTokenList {...defaultProps} ranked={[]} />);

    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('renders TrenchesPanel, unwrapped in a second border, under the Trenches tab', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Trenches' }));

    expect(screen.getByText('TrenchesPanel')).toBeInTheDocument();
  });

  it('renders LeaderboardSidebar under the Ranks tab', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Ranks' }));

    expect(screen.getByText('LeaderboardSidebar')).toBeInTheDocument();
  });

  it('renders TradersSidebar under the Traders tab', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Traders' }));

    expect(screen.getByText('TradersSidebar')).toBeInTheDocument();
  });

  it('shows a real honest "not built yet" message under the Alerts tab, never a fake empty list', async () => {
    const user = userEvent.setup();
    render(<DiscoverTokenList {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Alerts' }));

    expect(screen.getByText("Alerts aren't built yet")).toBeInTheDocument();
  });

  it("marks the real currently selected token's row as selected, using the composite chain+address key", () => {
    const market = fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa', symbol: 'AAA' });
    render(<DiscoverTokenList {...defaultProps} ranked={[market]} selectedKey="eip155:8453:0xaaa" />);

    expect(screen.getByText(/AAA \(selected\)/)).toBeInTheDocument();
  });

  it('passes the real selectionDisabled flag through to every row', () => {
    render(<DiscoverTokenList {...defaultProps} ranked={[fakeMarket({ symbol: 'AAA' })]} selectionDisabled />);

    expect(screen.getByText(/AAA.*\(disabled\)/)).toBeInTheDocument();
  });
});
