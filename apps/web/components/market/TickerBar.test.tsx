import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { TickerBar, topByVolume } from './TickerBar';

// The ticker now listens to the live market stream; this stands in for the stream's first
// Trending snapshot, fed from whatever list each test sets up.
const { fetchDiscoverMarkets } = vi.hoisted(() => ({ fetchDiscoverMarkets: vi.fn() }));
vi.mock('@/lib/market-feeds', () => ({
  subscribeToMarketFeeds: (listener: (type: string, data: unknown) => void) => {
    let active = true;
    Promise.resolve(fetchDiscoverMarkets())
      .then((markets: MarketSummary[] | undefined) => {
        if (active && markets) listener('trending', { markets, atIso: '' });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  },
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

describe('TickerBar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing at all before the first fetch resolves', () => {
    fetchDiscoverMarkets.mockReturnValue(new Promise(() => {}));
    const { container } = render(<TickerBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing at all on a fetch failure — a dead ticker just stays empty, never breaks the page', async () => {
    fetchDiscoverMarkets.mockRejectedValue(new Error('network error'));
    const { container } = render(<TickerBar />);

    await vi.waitFor(() => expect(fetchDiscoverMarkets).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Trending feed ordered by 24h volume, skipping markets with no volume yet', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ symbol: 'LOW', tokenAddress: '0x1', volume24hUsd: 1_000 }),
      fakeMarket({ symbol: 'NONE', tokenAddress: '0x2', volume24hUsd: null }),
      fakeMarket({ symbol: 'HIGH', tokenAddress: '0x3', volume24hUsd: 9_000_000 }),
    ]);
    render(<TickerBar />);

    const symbols = (await screen.findAllByText(/^\$(LOW|HIGH|NONE)$/)).map((el) => el.textContent);
    expect(symbols.slice(0, 2)).toEqual(['$HIGH', '$LOW']);
    expect(symbols).not.toContain('$NONE');
  });

  it('caps the ticker at 20 markets', () => {
    const many = Array.from({ length: 30 }, (_, i) => fakeMarket({ tokenAddress: `0x${i}`, volume24hUsd: i }));
    expect(topByVolume(many)).toHaveLength(20);
  });

  it('doubles the real fetched list so the marquee loop point is invisible', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ symbol: 'FOO' })]);
    render(<TickerBar />);

    expect(await screen.findAllByText('$FOO')).toHaveLength(2);
  });

  it('links a Base-chain ticker item to its real chain-scoped URL', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' }),
    ]);
    render(<TickerBar />);

    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain ticker item to its own chain-scoped URL, never defaulting to Base', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' }),
    ]);
    render(<TickerBar />);

    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/market/bnb/0xbbb');
  });

  it('does not make an unrecognized-chain ticker item route to Base', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ chainIdentifier: 'eip155:999999', tokenAddress: '0xccc' }),
    ]);
    render(<TickerBar />);

    await screen.findAllByText('$FOO');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle('This market is visible for discovery but is not tradeable here yet'),
    ).toHaveLength(2);
  });

  it('links a Solana ticker item to the Solana trade page and never doubles a "$" already in the symbol', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ chainIdentifier: 'solana', symbol: '$WIF', tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' }),
    ]);
    render(<TickerBar />);

    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/solana?mint=EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');
    expect(screen.getAllByText('$WIF').length).toBeGreaterThan(0);
    expect(screen.queryByText('$$WIF')).not.toBeInTheDocument();
  });

  it('shows a real "?" placeholder for a symbol-less token rather than a blank', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ symbol: null })]);
    render(<TickerBar />);

    expect(await screen.findAllByText('$?')).toHaveLength(2);
  });

  it('colors a real positive price change up, and a negative one down', async () => {
    fetchDiscoverMarkets.mockResolvedValue([
      fakeMarket({ tokenAddress: '0xup', priceChange24hPct: 5 }),
      fakeMarket({ tokenAddress: '0xdown', priceChange24hPct: -5 }),
    ]);
    render(<TickerBar />);

    expect((await screen.findAllByText('+5.00%'))[0]).toHaveClass('text-up');
    expect(screen.getAllByText('-5.00%')[0]).toHaveClass('text-down');
  });

  it('colors a real zero price change flat, neither up nor down', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ priceChange24hPct: 0 })]);
    render(<TickerBar />);

    const pct = (await screen.findAllByText('0.00%'))[0];
    expect(pct).toHaveClass('text-ink-400');
    expect(pct).not.toHaveClass('text-up');
    expect(pct).not.toHaveClass('text-down');
  });

  it('never polls — it only listens to the stream', async () => {
    vi.useFakeTimers();
    fetchDiscoverMarkets.mockResolvedValue([]);
    render(<TickerBar />);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchDiscoverMarkets).toHaveBeenCalledTimes(1); // the one stream subscription

    vi.useRealTimers();
  });
});
