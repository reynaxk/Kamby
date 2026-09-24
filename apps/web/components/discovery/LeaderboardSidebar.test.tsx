import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Leaderboard, LeaderboardEntry } from '@kamby/domain';
import { LeaderboardSidebar } from './LeaderboardSidebar';

const { fetchLeaderboard } = vi.hoisted(() => ({ fetchLeaderboard: vi.fn() }));
vi.mock('@/lib/social-client', () => ({ fetchLeaderboard }));
// TraderIdentity and PnlValue both have their own separate coverage — isolated here so this
// file only exercises LeaderboardSidebar's own window-switching/fetch/render logic.
vi.mock('@/components/social/TraderIdentity', () => ({
  TraderIdentity: ({ address }: { address: string }) => <span>{address}</span>,
}));
vi.mock('@/components/social/PnlValue', () => ({
  PnlValue: ({ usd }: { usd: number }) => <span>${usd}</span>,
}));

function fakeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    userId: '11111111-1111-1111-1111-111111111111',
    username: 'whale1',
    avatarUrl: null,
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    realizedPnlUsd: 500,
    realizedPnlPct: 20,
    volumeUsd: 10_000,
    ...overrides,
  };
}

function fakeLeaderboard(entries: LeaderboardEntry[] = [fakeEntry()], window: Leaderboard['window'] = '24h'): Leaderboard {
  return { window, entries };
}

describe('LeaderboardSidebar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the real 24h window by default', async () => {
    fetchLeaderboard.mockResolvedValue(fakeLeaderboard());
    render(<LeaderboardSidebar />);

    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith('24h', 15));
  });

  it('shows a real loading state before the first fetch resolves', () => {
    fetchLeaderboard.mockReturnValue(new Promise(() => {}));
    render(<LeaderboardSidebar />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    fetchLeaderboard.mockRejectedValue(new Error('network error'));
    render(<LeaderboardSidebar />);

    expect(await screen.findByText("Couldn't load the leaderboard.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state when the window has no realized PnL yet', async () => {
    fetchLeaderboard.mockResolvedValue(fakeLeaderboard([]));
    render(<LeaderboardSidebar />);

    expect(await screen.findByText('No realized PnL yet in this window.')).toBeInTheDocument();
  });

  it('numbers entries by their real rank (position), 1-indexed', async () => {
    fetchLeaderboard.mockResolvedValue(
      fakeLeaderboard([fakeEntry({ userId: 'u1', walletAddress: '0xaaa' }), fakeEntry({ userId: 'u2', walletAddress: '0xbbb' })]),
    );
    render(<LeaderboardSidebar />);
    await screen.findByText('0xaaa');

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it("links each entry to the real trader's own profile page", async () => {
    fetchLeaderboard.mockResolvedValue(fakeLeaderboard([fakeEntry({ walletAddress: '0xaaa' })]));
    render(<LeaderboardSidebar />);
    await screen.findByText('0xaaa');

    expect(screen.getByRole('link')).toHaveAttribute('href', '/trader/0xaaa');
  });

  it('refetches with the real newly selected window on tab click', async () => {
    fetchLeaderboard.mockResolvedValue(fakeLeaderboard());
    const user = userEvent.setup();
    render(<LeaderboardSidebar />);
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith('24h', 15));

    await user.click(screen.getByRole('button', { name: '7D' }));

    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith('7d', 15));
  });

  it('discards a stale in-flight response from a previous window after a fast switch', async () => {
    // A real race: window A's fetch is still pending when the user switches to window B.
    // The effect's own `cancelled` guard must stop A's late response from ever overwriting
    // B's already-rendered data.
    let resolveA: (v: Leaderboard) => void = () => {};
    fetchLeaderboard.mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)));
    const user = userEvent.setup();
    render(<LeaderboardSidebar />);
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledWith('24h', 15));

    fetchLeaderboard.mockResolvedValueOnce(fakeLeaderboard([fakeEntry({ walletAddress: '0xfresh' })], '7d'));
    await user.click(screen.getByRole('button', { name: '7D' }));
    await screen.findByText('0xfresh');

    resolveA(fakeLeaderboard([fakeEntry({ walletAddress: '0xstale' })], '24h'));
    await new Promise((r) => setTimeout(r, 0)); // let any (wrongly) pending state update flush

    expect(screen.queryByText('0xstale')).not.toBeInTheDocument();
    expect(screen.getByText('0xfresh')).toBeInTheDocument();
  });
});
