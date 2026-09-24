import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopTrader } from '@kamby/domain';
import { TradersSidebar } from './TradersSidebar';

const { fetchTopTraders } = vi.hoisted(() => ({ fetchTopTraders: vi.fn() }));
vi.mock('@/lib/social-client', () => ({ fetchTopTraders }));
// TraderIdentity has its own separate coverage — isolated here so this file only exercises
// TradersSidebar's own fetch/render logic.
vi.mock('@/components/social/TraderIdentity', () => ({
  TraderIdentity: ({ address }: { address: string }) => <span>{address}</span>,
}));

function fakeTrader(overrides: Partial<TopTrader> = {}): TopTrader {
  return {
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    username: 'whale1',
    avatarUrl: null,
    volumeUsd: 500_000,
    tradeCount: 42,
    ...overrides,
  };
}

describe('TradersSidebar', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the real top traders with the real limit', async () => {
    fetchTopTraders.mockResolvedValue([]);
    render(<TradersSidebar />);

    await vi.waitFor(() => expect(fetchTopTraders).toHaveBeenCalledWith(20));
  });

  it('shows a real loading state before the first fetch resolves', () => {
    fetchTopTraders.mockReturnValue(new Promise(() => {}));
    render(<TradersSidebar />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    fetchTopTraders.mockRejectedValue(new Error('network error'));
    render(<TradersSidebar />);

    expect(await screen.findByText("Couldn't load traders.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state when no trader has cleared the activity floor', async () => {
    fetchTopTraders.mockResolvedValue([]);
    render(<TradersSidebar />);

    expect(await screen.findByText('No trader has cleared the activity floor yet.')).toBeInTheDocument();
  });

  it("links each trader to their own real profile page, showing real volume and trade count", async () => {
    fetchTopTraders.mockResolvedValue([fakeTrader({ address: '0xaaa', volumeUsd: 750_000, tradeCount: 12 })]);
    render(<TradersSidebar />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/trader/0xaaa');
    expect(screen.getByText('$750.0K')).toBeInTheDocument();
    expect(screen.getByText('12 trades')).toBeInTheDocument();
  });

  it('renders every real trader in the returned list, in the given order', async () => {
    fetchTopTraders.mockResolvedValue([
      fakeTrader({ address: '0xaaa' }),
      fakeTrader({ address: '0xbbb' }),
      fakeTrader({ address: '0xccc' }),
    ]);
    render(<TradersSidebar />);

    const links = await screen.findAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/trader/0xaaa', '/trader/0xbbb', '/trader/0xccc']);
  });
});
