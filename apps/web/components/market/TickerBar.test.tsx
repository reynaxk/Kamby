import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { TickerBar } from './TickerBar';

const { fetchDiscoverMarkets } = vi.hoisted(() => ({ fetchDiscoverMarkets: vi.fn() }));
vi.mock('@/lib/market-client', () => ({ fetchDiscoverMarkets }));

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

  it('fetches the real volume-sorted top 20 on mount', async () => {
    fetchDiscoverMarkets.mockResolvedValue([]);
    render(<TickerBar />);

    await vi.waitFor(() => expect(fetchDiscoverMarkets).toHaveBeenCalledWith({ sort: 'volume', limit: 20 }));
  });

  it('doubles the real fetched list so the marquee loop point is invisible', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ symbol: 'FOO' })]);
    render(<TickerBar />);

    expect(await screen.findAllByText('$FOO')).toHaveLength(2);
  });

  it('links a Base-chain ticker item to its real chain-scoped URL', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' })]);
    render(<TickerBar />);

    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain ticker item to its own chain-scoped URL, never defaulting to Base', async () => {
    fetchDiscoverMarkets.mockResolvedValue([fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' })]);
    render(<TickerBar />);

    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/market/bnb/0xbbb');
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

  it('polls again every 20s', async () => {
    vi.useFakeTimers();
    fetchDiscoverMarkets.mockResolvedValue([]);
    render(<TickerBar />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiscoverMarkets).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchDiscoverMarkets).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
