import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonalizedFeedItem, SocialActivity } from '@kamby/domain';
import { PersonalizedFeed } from './PersonalizedFeed';

const { fetchPersonalizedFeed, hasStoredSession, subscribeToActivityStream } = vi.hoisted(() => ({
  fetchPersonalizedFeed: vi.fn(),
  hasStoredSession: vi.fn(),
  subscribeToActivityStream: vi.fn((_onPing: () => void, _onStatus: (status: string) => void) => vi.fn()),
}));
vi.mock('@/lib/discovery-client', () => ({ fetchPersonalizedFeed, hasStoredSession }));
vi.mock('@/lib/social-client', () => ({ subscribeToActivityStream }));
// ActivityCard and ReasonTag both have their own separate concerns — isolated here so this
// file only exercises PersonalizedFeed's own state machine, paging, and realtime-ping logic.
vi.mock('@/components/social/ActivityCard', () => ({
  ActivityCard: ({ activity }: { activity: SocialActivity }) => <div>ActivityCard:{activity.id}</div>,
}));
vi.mock('./ReasonTag', () => ({ ReasonTag: ({ reason }: { reason: string }) => <span>{reason}</span> }));

function fakeActivity(overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainIdentifier: 'eip155:8453',
    trader: { address: '0xaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: {
      address: '0xtoken',
      symbol: 'FOO',
      name: 'Foo',
      logoUrl: null,
      decimals: 18,
      quoteAddress: '0xquote',
      quoteSymbol: 'WETH',
      quoteDecimals: 18,
    },
    amountUsd: 2_000,
    tokenAmount: 100,
    priceUsd: 20,
    timestamp: new Date().toISOString(),
    txHash: '0xtx',
    chainId: 8453,
    social: { likes: 0, likedByMe: null },
    ...overrides,
  };
}

function fakeItem(overrides: Partial<PersonalizedFeedItem> = {}): PersonalizedFeedItem {
  return { activity: fakeActivity(), reasonCode: 'FOLLOWED_TRADER', reason: 'Because you follow Alex', ...overrides };
}

describe('PersonalizedFeed', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing at all and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    const { container } = render(<PersonalizedFeed />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchPersonalizedFeed).not.toHaveBeenCalled();
    expect(subscribeToActivityStream).not.toHaveBeenCalled();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockRejectedValue(new Error('network error'));
    render(<PersonalizedFeed />);

    expect(await screen.findByText("Couldn't load your personalized feed.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state once loaded with zero items, not stuck loading', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockResolvedValue({ items: [], nextCursor: null });
    render(<PersonalizedFeed />);

    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('renders the real reason and activity for each fetched item', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockResolvedValue({
      items: [fakeItem({ activity: fakeActivity({ id: 'a' }), reason: 'Because you follow Alex' })],
      nextCursor: null,
    });
    render(<PersonalizedFeed />);

    expect(await screen.findByText('Because you follow Alex')).toBeInTheDocument();
    expect(screen.getByText('ActivityCard:a')).toBeInTheDocument();
  });

  it('never shows Load more when there is no real next cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockResolvedValue({ items: [fakeItem()], nextCursor: null });
    render(<PersonalizedFeed />);
    await screen.findByText('ActivityCard:11111111-1111-1111-1111-111111111111');

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('appends the real next page on Load more and forwards the real cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed
      .mockResolvedValueOnce({ items: [fakeItem({ activity: fakeActivity({ id: 'a' }) })], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [fakeItem({ activity: fakeActivity({ id: 'b' }) })], nextCursor: null });
    const user = userEvent.setup();
    render(<PersonalizedFeed />);
    await screen.findByText('ActivityCard:a');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('ActivityCard:b')).toBeInTheDocument();
    expect(screen.getByText('ActivityCard:a')).toBeInTheDocument(); // appended, not replaced
    expect(fetchPersonalizedFeed).toHaveBeenLastCalledWith({ cursor: 'cursor-1', limit: 15 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('never subscribes to the realtime activity stream without a stored session', async () => {
    hasStoredSession.mockReturnValue(false);
    render(<PersonalizedFeed />);

    expect(subscribeToActivityStream).not.toHaveBeenCalled();
  });

  it('shows a real "New activity" pill once a realtime ping arrives, and none before that', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockResolvedValue({ items: [fakeItem()], nextCursor: null });
    let onPing: (() => void) | undefined;
    subscribeToActivityStream.mockImplementation((ping) => {
      onPing = ping;
      return vi.fn();
    });
    render(<PersonalizedFeed />);
    await screen.findByText('ActivityCard:11111111-1111-1111-1111-111111111111');
    expect(screen.queryByRole('button', { name: /New activity/ })).not.toBeInTheDocument();

    onPing?.();

    expect(await screen.findByRole('button', { name: /New activity/ })).toBeInTheDocument();
  });

  it('refetches and hides the pill when "New activity" is clicked', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed
      .mockResolvedValueOnce({ items: [fakeItem({ activity: fakeActivity({ id: 'a' }) })], nextCursor: null })
      .mockResolvedValueOnce({ items: [fakeItem({ activity: fakeActivity({ id: 'b' }) })], nextCursor: null });
    let onPing: (() => void) | undefined;
    subscribeToActivityStream.mockImplementation((ping) => {
      onPing = ping;
      return vi.fn();
    });
    const user = userEvent.setup();
    render(<PersonalizedFeed />);
    await screen.findByText('ActivityCard:a');
    onPing?.();
    await screen.findByRole('button', { name: /New activity/ });

    await user.click(screen.getByRole('button', { name: /New activity/ }));

    expect(await screen.findByText('ActivityCard:b')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New activity/ })).not.toBeInTheDocument();
    expect(fetchPersonalizedFeed).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes from the realtime stream on unmount', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedFeed.mockResolvedValue({ items: [], nextCursor: null });
    const unsubscribe = vi.fn();
    subscribeToActivityStream.mockReturnValue(unsubscribe);
    const { unmount } = render(<PersonalizedFeed />);
    await screen.findByText('Nothing here yet.');

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
