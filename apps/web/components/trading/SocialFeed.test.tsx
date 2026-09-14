import type { SolanaSocialActivity } from '@kamby/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeStatus } from '@/lib/social-client';
import { SocialFeed } from './SocialFeed';

const { subscribeToSolanaActivityStream, fetchLatestSolanaActivity } = vi.hoisted(() => ({
  subscribeToSolanaActivityStream: vi.fn(),
  fetchLatestSolanaActivity: vi.fn(),
}));

vi.mock('@/lib/solana-social-client', () => ({ subscribeToSolanaActivityStream, fetchLatestSolanaActivity }));

function activity(id: string, overrides: Partial<SolanaSocialActivity> = {}): SolanaSocialActivity {
  return {
    id,
    walletAddress: '8nTncbaJ8gc8ooDWRFt9TKjog7743iHC43iEcesAbAee',
    side: 'BUY',
    tokenMint: 'So11111111111111111111111111111111111111112',
    amountUsd: 450,
    signature: `sig-${id}`.padEnd(80, '1'),
    confirmedAt: new Date().toISOString(),
    ...overrides,
  };
}

let capturedOnPing: (() => void) | null = null;

beforeEach(() => {
  subscribeToSolanaActivityStream.mockImplementation((onPing: () => void, onStatus: (s: RealtimeStatus) => void) => {
    capturedOnPing = onPing;
    onStatus('connecting');
    return () => {};
  });
});

afterEach(() => {
  vi.clearAllMocks();
  capturedOnPing = null;
});

describe('SocialFeed', () => {
  it('shows an honest empty state, never fabricated rows, when there is no real activity yet', async () => {
    fetchLatestSolanaActivity.mockResolvedValue({ items: [], nextCursor: null });
    render(<SocialFeed />);
    expect(await screen.findByText('No recent activity yet.')).toBeInTheDocument();
  });

  it('shows an honest error state, not an empty-looking feed, when the initial load fails', async () => {
    fetchLatestSolanaActivity.mockRejectedValue(new Error('network error'));
    render(<SocialFeed />);
    expect(await screen.findByText("Couldn't load live activity.")).toBeInTheDocument();
  });

  it('renders a compact row per real activity item with the wallet, side, amount, token, and Solscan link', async () => {
    fetchLatestSolanaActivity.mockResolvedValue({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('SOL')).toBeInTheDocument();
    expect(screen.getByText('8nTncb…bAee')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '↗' })).toHaveAttribute('href', expect.stringContaining('solscan.io/tx/'));
  });

  it('shows a truncated mint address for a non-SOL token, never a fabricated symbol', async () => {
    fetchLatestSolanaActivity.mockResolvedValue({
      items: [activity('a', { tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })],
      nextCursor: null,
    });
    render(<SocialFeed />);
    expect(await screen.findByText('EPjFWd…Dt1v')).toBeInTheDocument();
  });

  it('labels this feed by chain — Solana, not a generic or Base label', async () => {
    fetchLatestSolanaActivity.mockResolvedValue({ items: [], nextCursor: null });
    render(<SocialFeed />);
    expect(await screen.findByText(/Solana/i)).toBeInTheDocument();
  });

  it('never links a wallet handle to the EVM-only trader profile page', async () => {
    fetchLatestSolanaActivity.mockResolvedValue({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);
    await screen.findByText('BUY');
    expect(screen.queryByRole('link', { name: /8nTn/ })).not.toBeInTheDocument();
  });

  it('shows a "N new" pill after a live ping, and clicking it refetches and clears the pill', async () => {
    fetchLatestSolanaActivity.mockResolvedValueOnce({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);
    await screen.findByText('BUY');

    fetchLatestSolanaActivity.mockResolvedValueOnce({ items: [activity('b'), activity('a')], nextCursor: null });
    capturedOnPing?.();

    expect(await screen.findByText('1 new trade')).toBeInTheDocument();

    await userEvent.click(screen.getByText('1 new trade'));

    await waitFor(() => expect(screen.queryByText('1 new trade')).not.toBeInTheDocument());
    expect(fetchLatestSolanaActivity).toHaveBeenCalledTimes(2);
  });
});
