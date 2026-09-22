import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';

const { fetchSearchResults, push, checkWatchStatus } = vi.hoisted(() => ({
  fetchSearchResults: vi.fn(),
  push: vi.fn(),
  checkWatchStatus: vi.fn(),
}));

vi.mock('@/lib/market-client', () => ({ fetchSearchResults }));
vi.mock('@/lib/watchlist-client', () => ({
  checkWatchStatus,
  watchToken: vi.fn(),
  unwatchToken: vi.fn(),
  hasStoredSession: () => false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function market(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chainIdentifier: 'base',
    tokenAddress: '0xabc0000000000000000000000000000000000a',
    symbol: 'PEPE',
    name: 'Pepe',
    logoUrl: null,
    priceUsd: 0.0001,
    ...overrides,
  };
}

describe('SearchBar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current search term as the input value', () => {
    fetchSearchResults.mockResolvedValue([]);
    render(<SearchBar defaultValue="WBNB" />);
    expect(screen.getByRole('textbox')).toHaveValue('WBNB');
  });

  it('shows an empty box when there is no active search', () => {
    render(<SearchBar />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(fetchSearchResults).not.toHaveBeenCalled();
  });

  // Real bug fixed 2026-09-17, still real now that value/results are lifted into the
  // component's own state (not just the DOM input) for live-typeahead: a later render with a
  // different `defaultValue` (e.g. after navigating from a search back to the plain Discover
  // view) must not leave the OLD term or its stale results stuck. The caller (MarketHeader)
  // keys `<SearchBar key={searchValue}>` on the server-known term specifically so a real
  // navigation fully remounts it — simulated here the same way, since jsdom has no real
  // navigation to trigger that key change on its own.
  it('resets its visible value when defaultValue changes on rerender, rather than keeping the stale text', () => {
    fetchSearchResults.mockResolvedValue([]);
    const { rerender } = render(<SearchBar key="WBNB" defaultValue="WBNB" />);
    expect(screen.getByRole('textbox')).toHaveValue('WBNB');

    rerender(<SearchBar key="" defaultValue={undefined} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('resets to the new term (not the old one) when defaultValue changes to a different search', () => {
    fetchSearchResults.mockResolvedValue([]);
    const { rerender } = render(<SearchBar key="WBNB" defaultValue="WBNB" />);
    rerender(<SearchBar key="cbBTC" defaultValue="cbBTC" />);
    expect(screen.getByRole('textbox')).toHaveValue('cbBTC');
  });

  it('debounces and shows live results with a link and a watch star per row, not on every keystroke', async () => {
    checkWatchStatus.mockResolvedValue(false);
    fetchSearchResults.mockResolvedValue([market()]);
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.type(screen.getByRole('textbox'), 'pepe');
    expect(fetchSearchResults).not.toHaveBeenCalled(); // not yet — still debouncing

    await waitFor(() => expect(fetchSearchResults).toHaveBeenCalledWith('pepe', 6));
    expect(await screen.findByText('PEPE')).toBeInTheDocument();
    expect(screen.getByLabelText('Search results')).toBeInTheDocument();
  });

  it('navigates to the token page and closes the dropdown when a result is clicked', async () => {
    checkWatchStatus.mockResolvedValue(false);
    fetchSearchResults.mockResolvedValue([market()]);
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.type(screen.getByRole('textbox'), 'pepe');
    await screen.findByText('PEPE');
    await user.click(screen.getByText('PEPE'));

    expect(push).toHaveBeenCalledWith('/market/base/0xabc0000000000000000000000000000000000a');
    expect(screen.queryByLabelText('Search results')).not.toBeInTheDocument();
  });

  it('clears results once the input is emptied again', async () => {
    checkWatchStatus.mockResolvedValue(false);
    fetchSearchResults.mockResolvedValue([market()]);
    const user = userEvent.setup();
    render(<SearchBar />);

    await user.type(screen.getByRole('textbox'), 'pepe');
    await screen.findByText('PEPE');

    await user.clear(screen.getByRole('textbox'));
    await waitFor(() => expect(screen.queryByText('PEPE')).not.toBeInTheDocument());
  });
});
