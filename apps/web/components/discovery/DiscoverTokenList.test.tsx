import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { emptyMarketFeeds, type CryptoPrice, type FeedMarket, type MarketFeedSnapshot, type MarketSummary, type PumpFunTokenSummary } from '@kamby/domain';
import { DiscoverTokenList } from './DiscoverTokenList';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// LeaderboardSidebar/TradersSidebar/SelectableTokenRow have their own coverage — mocked here
// so this file only exercises DiscoverTokenList's tab routing and per-tab data mapping.
vi.mock('./LeaderboardSidebar', () => ({ LeaderboardSidebar: () => <div>LeaderboardSidebar</div> }));
vi.mock('./TradersSidebar', () => ({ TradersSidebar: () => <div>TradersSidebar</div> }));
vi.mock('./SelectableTokenRow', () => ({
  SelectableTokenRow: ({
    market,
    selected,
    disabled,
    onSelect,
    isNew,
  }: {
    market: MarketSummary;
    selected: boolean;
    disabled: boolean;
    onSelect: (market: MarketSummary) => void;
    isNew?: boolean;
  }) => (
    <button type="button" onClick={() => onSelect(market)}>
      {market.symbol} {selected ? '(selected)' : ''} {disabled ? '(disabled)' : ''} {isNew ? '(new)' : ''}
    </button>
  ),
}));

function fakeMarket(overrides: Partial<FeedMarket> = {}): FeedMarket {
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
    listing: 'vetted',
    ...overrides,
  };
}

function fakeCurve(overrides: Partial<PumpFunTokenSummary> = {}): PumpFunTokenSummary {
  return {
    mintAddress: 'MintAAAA1111111111111111111111111111111111',
    name: 'Curve',
    symbol: 'CURVE',
    uri: null,
    virtualSolReserves: '40000000000',
    virtualTokenReserves: '800000000000000',
    realSolReserves: '10000000000',
    realTokenReserves: '520000000000000',
    tokenTotalSupply: '1000000000000000',
    graduationProgressPct: 11.76,
    complete: false,
    createdAt: new Date().toISOString(),
    graduatedAt: null,
    ...overrides,
  };
}

const atIso = new Date(0).toISOString();
function feeds(overrides: Partial<MarketFeedSnapshot> = {}): MarketFeedSnapshot {
  return { ...emptyMarketFeeds(), ...overrides };
}

const defaultProps = { feeds: feeds(), selectedKey: null, onSelect: vi.fn(), selectionDisabled: false };

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
}

describe('DiscoverTokenList', () => {
  it('shows the five live feed tabs, defaulting to Trending', () => {
    render(<DiscoverTokenList {...defaultProps} feeds={feeds({ trending: { markets: [fakeMarket({ symbol: 'AAA' })], atIso } })} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Trending', 'Trenches', 'Bonding', 'Graduated', 'Crypto']);
    expect(screen.getByRole('tab', { name: 'Trending' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/AAA/)).toBeInTheDocument();
  });

  it('marks discovered rows "new" in Trending, and hand-picked ones not', () => {
    render(
      <DiscoverTokenList
        {...defaultProps}
        feeds={feeds({ trending: { markets: [fakeMarket({ symbol: 'VET' }), fakeMarket({ symbol: 'NEWB', tokenAddress: '0xbbbb', listing: 'new' })], atIso } })}
      />,
    );

    expect(screen.getByText(/NEWB.*\(new\)/)).toBeInTheDocument();
    expect(screen.getByText(/VET/)).not.toHaveTextContent('(new)');
  });

  it('shows bonding-curve coins in Trenches and Bonding as view-only rows with their progress', async () => {
    render(
      <DiscoverTokenList
        {...defaultProps}
        feeds={feeds({ trenches: { tokens: [fakeCurve({ symbol: 'FRESH' })], atIso }, bonding: { tokens: [fakeCurve({ symbol: 'CLOSE', mintAddress: 'MintBBBB', graduationProgressPct: 91 })], atIso } })}
      />,
    );

    await openTab('Trenches');
    expect(screen.getByText('$FRESH')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /FRESH/ })).not.toBeInTheDocument();

    await openTab('Bonding');
    expect(screen.getByText('$CLOSE')).toBeInTheDocument();
    expect(screen.getByLabelText('91% of the way to graduating')).toBeInTheDocument();
  });

  it('lists new Base/BNB pools and Pump.fun graduations under Graduated, graduations linking to their Solana trade page', async () => {
    render(
      <DiscoverTokenList
        {...defaultProps}
        feeds={feeds({
          graduated: {
            markets: [fakeMarket({ symbol: 'POOL', listing: 'new' })],
            pumpfun: [fakeCurve({ symbol: 'GRAD', mintAddress: 'MintGRAD', complete: true, graduatedAt: new Date().toISOString() })],
            atIso,
          },
        })}
      />,
    );

    await openTab('Graduated');
    expect(screen.getByText('New pools · Base & BNB')).toBeInTheDocument();
    expect(screen.getByText(/POOL.*\(new\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GRAD/ })).toHaveAttribute('href', '/solana?mint=MintGRAD');
  });

  it('opens the market a Crypto row trades as — selecting it in the terminal when it is listed', async () => {
    const onSelect = vi.fn();
    const weth = fakeMarket({ symbol: 'WETH', tokenAddress: '0x4200000000000000000000000000000000000006' });
    const eth: CryptoPrice = { symbol: 'ETH', priceUsd: 2700, change24hPct: -1.2, updatedAtIso: atIso };
    const sol: CryptoPrice = { symbol: 'SOL', priceUsd: 120, change24hPct: 0.4, updatedAtIso: atIso };
    render(<DiscoverTokenList {...defaultProps} onSelect={onSelect} feeds={feeds({ trending: { markets: [weth], atIso }, crypto: { prices: [eth, sol], atIso } })} />);

    await openTab('Crypto');
    await userEvent.click(screen.getByRole('button', { name: /^ETH/ }));
    expect(onSelect).toHaveBeenCalledWith(weth);

    await userEvent.click(screen.getByRole('button', { name: /^SOL/ }));
    expect(push).toHaveBeenCalledWith('/solana');
  });

  it('shows an honest empty state per tab, never a blank panel', async () => {
    render(<DiscoverTokenList {...defaultProps} />);

    expect(screen.getByText('Nothing trending yet.')).toBeInTheDocument();
    await openTab('Crypto');
    expect(screen.getByText('Connecting to live prices…')).toBeInTheDocument();
  });

  it('keeps a Solana row clickable, opening the Solana trade page instead of selecting it into the EVM terminal', async () => {
    const onSelect = vi.fn();
    render(
      <DiscoverTokenList
        {...defaultProps}
        onSelect={onSelect}
        feeds={feeds({ trending: { markets: [fakeMarket({ symbol: 'BONK', chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' })], atIso } })}
      />,
    );

    const row = screen.getByRole('button', { name: /BONK/ });
    expect(row).not.toHaveTextContent('(disabled)');
    await userEvent.click(row);
    expect(push).toHaveBeenCalledWith('/solana?mint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the currently selected token by its chain+address key, and disables rows mid-trade', () => {
    render(<DiscoverTokenList {...defaultProps} selectionDisabled selectedKey="eip155:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" feeds={feeds({ trending: { markets: [fakeMarket({ symbol: 'AAA' })], atIso } })} />);

    expect(screen.getByText(/AAA.*\(selected\).*\(disabled\)/)).toBeInTheDocument();
  });

  it('renders the Leaderboard and Feed sidebars and an honest "not built" Alerts tab', async () => {
    render(<DiscoverTokenList {...defaultProps} />);

    await userEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));
    expect(screen.getByText('LeaderboardSidebar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Feed' }));
    expect(screen.getByText('TradersSidebar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    expect(screen.getByText("Alerts aren't built yet")).toBeInTheDocument();
  });
});
