import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '@kamby/domain';
import { NotificationList } from './NotificationList';

const { fetchNotifications, markNotificationRead, hasStoredSession } = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  hasStoredSession: vi.fn(),
}));

vi.mock('@/lib/notifications-client', () => ({ fetchNotifications, markNotificationRead }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));
// NotificationItem has its own real rendering logic (avatar, kind color, deep-link vs button)
// tested separately — this file isolates NotificationList's own state machine and paging.
vi.mock('./NotificationItem', () => ({
  NotificationItem: ({ notification, onOpen }: { notification: NotificationDto; onOpen: (n: NotificationDto) => void }) => (
    <button type="button" onClick={() => onOpen(notification)}>
      {notification.id}:{notification.readAt ? 'read' : 'unread'}
    </button>
  ),
}));

function fakeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'FOLLOW',
    createdAt: new Date().toISOString(),
    readAt: null,
    actor: null,
    token: null,
    amountUsd: null,
    side: null,
    deepLink: null,
    ...overrides,
  };
}

describe('NotificationList', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real no-session empty state and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<NotificationList />);

    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
    expect(fetchNotifications).not.toHaveBeenCalled();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockRejectedValue(new Error('network error'));
    render(<NotificationList />);

    expect(await screen.findByText("Couldn't load your notifications.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state once loaded with zero items, not stuck loading', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
    render(<NotificationList />);

    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
    expect(screen.getByText('Follows, likes, and trade alerts will show up here.')).toBeInTheDocument();
  });

  it('renders the real fetched items once loaded', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({
      items: [fakeNotification({ id: 'a' }), fakeNotification({ id: 'b' })],
      nextCursor: null,
    });
    render(<NotificationList />);

    expect(await screen.findByText('a:unread')).toBeInTheDocument();
    expect(screen.getByText('b:unread')).toBeInTheDocument();
  });

  it('passes the real limit through to the first fetch', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
    render(<NotificationList limit={5} />);

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledWith({ limit: 5 }));
  });

  it('never shows Load more when there is no real next cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [fakeNotification()], nextCursor: null });
    render(<NotificationList />);
    await screen.findByText(/unread/);

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('never shows Load more when the caller opts out via showLoadMore, even with a real cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [fakeNotification()], nextCursor: 'cursor-1' });
    render(<NotificationList showLoadMore={false} />);
    await screen.findByText(/unread/);

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('appends the real next page on Load more and forwards the real cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications
      .mockResolvedValueOnce({ items: [fakeNotification({ id: 'a' })], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [fakeNotification({ id: 'b' })], nextCursor: null });
    const user = userEvent.setup();
    render(<NotificationList />);
    await screen.findByText('a:unread');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('b:unread')).toBeInTheDocument();
    expect(screen.getByText('a:unread')).toBeInTheDocument(); // appended, not replaced
    expect(fetchNotifications).toHaveBeenLastCalledWith({ cursor: 'cursor-1', limit: 20 });
    // the cursor from the new page was null, so Load more disappears rather than staying stuck
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('marks a notification read optimistically in the UI even before the real request resolves', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [fakeNotification({ id: 'a' })], nextCursor: null });
    markNotificationRead.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<NotificationList />);
    await screen.findByText('a:unread');

    await user.click(screen.getByText('a:unread'));

    expect(await screen.findByText('a:read')).toBeInTheDocument();
    expect(markNotificationRead).toHaveBeenCalledWith('a');
  });

  it('leaves the optimistic read state standing even when the mark-read request fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({ items: [fakeNotification({ id: 'a' })], nextCursor: null });
    markNotificationRead.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<NotificationList />);
    await screen.findByText('a:unread');

    await user.click(screen.getByText('a:unread'));

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalled());
    expect(screen.getByText('a:read')).toBeInTheDocument(); // never reverted on failure
  });

  it('never re-marks an already-read notification, so it never re-issues the request', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications.mockResolvedValue({
      items: [fakeNotification({ id: 'a', readAt: new Date().toISOString() })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<NotificationList />);
    await screen.findByText('a:read');

    await user.click(screen.getByText('a:read'));

    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('refetches from the top when refreshKey changes, discarding the previous page', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotifications
      .mockResolvedValueOnce({ items: [fakeNotification({ id: 'a' })], nextCursor: null })
      .mockResolvedValueOnce({ items: [fakeNotification({ id: 'b' })], nextCursor: null });
    const { rerender } = render(<NotificationList refreshKey={1} />);
    await screen.findByText('a:unread');

    rerender(<NotificationList refreshKey={2} />);

    expect(await screen.findByText('b:unread')).toBeInTheDocument();
    expect(screen.queryByText('a:unread')).not.toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });
});
