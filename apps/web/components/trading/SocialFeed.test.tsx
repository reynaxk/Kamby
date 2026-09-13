import type { SocialActivity } from '@kamby/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeStatus } from '@/lib/social-client';
import { SocialFeed } from './SocialFeed';

const { subscribeToActivityStream, fetchLatestActivity } = vi.hoisted(() => ({
  subscribeToActivityStream: vi.fn(),
  fetchLatestActivity: vi.fn(),
}));

vi.mock('@/lib/social-client', () => ({ subscribeToActivityStream, fetchLatestActivity }));

function activity(id: string, overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id,
    chainIdentifier: 'eip155:8453',
    trader: { address: '0x1111111111111111111111111111111111aaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: null,
      logoUrl: null,
      decimals: 18,
      quoteAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      quoteSymbol: 'USDC',
      quoteDecimals: 6,
    },
    amountUsd: 450,
    tokenAmount: 1,
    priceUsd: 100,
    timestamp: new Date().toISOString(),
    txHash: `0x${id.padEnd(64, '0')}`,
    chainId: 8453,
    social: { likes: 0, likedByMe: null },
    ...overrides,
  };
}

let capturedOnPing: (() => void) | null = null;

beforeEach(() => {
  subscribeToActivityStream.mockImplementation((onPing: () => void, onStatus: (s: RealtimeStatus) => void) => {
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
    fetchLatestActivity.mockResolvedValue({ items: [], nextCursor: null });
    render(<SocialFeed />);
    expect(await screen.findByText('No recent activity yet.')).toBeInTheDocument();
  });

  it('shows an honest error state, not an empty-looking feed, when the initial load fails', async () => {
    fetchLatestActivity.mockRejectedValue(new Error('network error'));
    render(<SocialFeed />);
    expect(await screen.findByText("Couldn't load live activity.")).toBeInTheDocument();
  });

  it('renders a compact row per real activity item with the trader, action, amount, token, and tx link', async () => {
    fetchLatestActivity.mockResolvedValue({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);

    expect(await screen.findByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('$450.00')).toBeInTheDocument();
    expect(screen.getByText('WETH')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '↗' })).toHaveAttribute('href', expect.stringContaining('basescan.org/tx/'));
  });

  it('labels this feed by chain — never presented as Solana activity', async () => {
    fetchLatestActivity.mockResolvedValue({ items: [], nextCursor: null });
    render(<SocialFeed />);
    expect(await screen.findByText(/Base network/i)).toBeInTheDocument();
  });

  it('shows a "N new" pill after a live ping, and clicking it refetches and clears the pill', async () => {
    fetchLatestActivity.mockResolvedValueOnce({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);
    await screen.findByText('BUY');

    fetchLatestActivity.mockResolvedValueOnce({ items: [activity('b'), activity('a')], nextCursor: null });
    capturedOnPing?.();

    expect(await screen.findByText('1 new trade')).toBeInTheDocument();

    await userEvent.click(screen.getByText('1 new trade'));

    await waitFor(() => expect(screen.queryByText('1 new trade')).not.toBeInTheDocument());
    expect(fetchLatestActivity).toHaveBeenCalledTimes(2);
  });

  it('a real trader address links to their profile', async () => {
    fetchLatestActivity.mockResolvedValue({ items: [activity('a')], nextCursor: null });
    render(<SocialFeed />);

    const handleLink = await screen.findByRole('link', { name: '0x1111…aaaa' });
    expect(handleLink).toHaveAttribute('href', '/trader/0x1111111111111111111111111111111111aaaa');
  });
});
