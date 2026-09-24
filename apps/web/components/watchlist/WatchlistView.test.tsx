import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WatchedToken } from '@kamby/domain';
import { WatchlistView } from './WatchlistView';

const { fetchWatchlist, hasStoredSession } = vi.hoisted(() => ({
  fetchWatchlist: vi.fn(),
  hasStoredSession: vi.fn(),
}));

vi.mock('@/lib/watchlist-client', () => ({ fetchWatchlist, hasStoredSession }));
// TokenIdentity, PriceChange, and WatchButton all have their own separate coverage —
// isolated here so this file only exercises WatchlistView's own logic (state machine,
// paging, chain-aware URLs, and the optimistic unwatch removal).
vi.mock('@/components/market/TokenIdentity', () => ({
  TokenIdentity: ({ symbol }: { symbol: string | null }) => <span>{symbol}</span>,
}));
vi.mock('@/components/market/PriceChange', () => ({
  PriceChange: ({ value }: { value: number }) => <span>{value}%</span>,
}));
vi.mock('@/components/market/WatchButton', () => ({
  WatchButton: ({ address, onChange }: { address: string; onChange: (watching: boolean) => void }) => (
    <div>
      <button type="button" onClick={() => onChange(false)}>
        Unwatch {address}
      </button>
      <button type="button" onClick={() => onChange(true)}>
        Rewatch {address}
      </button>
    </div>
  ),
}));

function fakeWatchedToken(overrides: Partial<WatchedToken> = {}): WatchedToken {
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
    watchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('WatchlistView', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real no-session empty state and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<WatchlistView />);

    expect(screen.getByText('No watchlist yet.')).toBeInTheDocument();
    expect(fetchWatchlist).not.toHaveBeenCalled();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockRejectedValue(new Error('network error'));
    render(<WatchlistView />);

    expect(await screen.findByText("Couldn't load your watchlist.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state once loaded with zero items, not stuck loading', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({ items: [], nextCursor: null });
    render(<WatchlistView />);

    expect(await screen.findByText('Nothing on your watchlist yet.')).toBeInTheDocument();
  });

  it('links a Base-chain item to its real chain-scoped market URL', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({
      items: [fakeWatchedToken({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' })],
      nextCursor: null,
    });
    render(<WatchlistView />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain item to its own chain-scoped URL, never defaulting to Base', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({
      items: [fakeWatchedToken({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' })],
      nextCursor: null,
    });
    render(<WatchlistView />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/bnb/0xbbb');
  });

  it('falls back to the default chain slug rather than crashing for an unrecognized chain identifier', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({
      items: [fakeWatchedToken({ chainIdentifier: 'eip155:999999', tokenAddress: '0xccc' })],
      nextCursor: null,
    });
    render(<WatchlistView />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/base/0xccc');
  });

  it('never shows Load more when there is no real next cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({ items: [fakeWatchedToken()], nextCursor: null });
    render(<WatchlistView />);
    await screen.findByRole('link');

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('appends the real next page on Load more and forwards the real cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist
      .mockResolvedValueOnce({ items: [fakeWatchedToken({ tokenAddress: '0xaaa', symbol: 'AAA' })], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [fakeWatchedToken({ tokenAddress: '0xbbb', symbol: 'BBB' })], nextCursor: null });
    const user = userEvent.setup();
    render(<WatchlistView />);
    await screen.findByText('AAA');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('BBB')).toBeInTheDocument();
    expect(screen.getByText('AAA')).toBeInTheDocument(); // appended, not replaced
    expect(fetchWatchlist).toHaveBeenLastCalledWith({ cursor: 'cursor-1', limit: 20 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('removes an item from the list the instant it is unwatched, without waiting on a refetch', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({
      items: [fakeWatchedToken({ tokenAddress: '0xaaa', symbol: 'AAA' }), fakeWatchedToken({ tokenAddress: '0xbbb', symbol: 'BBB' })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<WatchlistView />);
    await screen.findByText('AAA');

    await user.click(screen.getByRole('button', { name: 'Unwatch 0xaaa' }));

    expect(screen.queryByText('AAA')).not.toBeInTheDocument();
    expect(screen.getByText('BBB')).toBeInTheDocument(); // the other item is untouched
    expect(fetchWatchlist).toHaveBeenCalledTimes(1); // no refetch triggered
  });

  it('never removes an item when the button reports it is still watched', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchWatchlist.mockResolvedValue({
      items: [fakeWatchedToken({ tokenAddress: '0xaaa', symbol: 'AAA' })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<WatchlistView />);
    await screen.findByText('AAA');

    await user.click(screen.getByRole('button', { name: 'Rewatch 0xaaa' }));

    expect(screen.getByText('AAA')).toBeInTheDocument();
  });
});
