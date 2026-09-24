import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const { fetchUnreadCount, markAllNotificationsRead, onLocalNotificationsRead, subscribeToNotificationStream, hasStoredSession } =
  vi.hoisted(() => ({
    fetchUnreadCount: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    onLocalNotificationsRead: vi.fn((_callback: () => void) => () => {}),
    subscribeToNotificationStream: vi.fn((_onPing: (ping: unknown) => void, _onStatus: (status: string) => void) => () => {}),
    hasStoredSession: vi.fn(),
  }));

vi.mock('@/lib/notifications-client', () => ({
  fetchUnreadCount,
  markAllNotificationsRead,
  onLocalNotificationsRead,
  subscribeToNotificationStream,
}));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));
// NotificationList has its own real fetch/render logic — isolated here since this file
// tests NotificationBell's own behavior (badge, open/close, mark-all), not the list itself.
vi.mock('./NotificationList', () => ({ NotificationList: () => <div data-testid="notification-list" /> }));

describe('NotificationBell', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never fetches an unread count or opens the realtime stream when there is no stored session — mounting must never start one', () => {
    // The real effect's `if (!hasStoredSession()) return;` guards both calls in the same
    // effect body — my first draft assumed the stream subscription was ungated and got
    // this assertion backwards; re-read the component to confirm before fixing.
    hasStoredSession.mockReturnValue(false);
    render(<NotificationBell />);

    expect(fetchUnreadCount).not.toHaveBeenCalled();
    expect(subscribeToNotificationStream).not.toHaveBeenCalled();
  });

  it('shows no badge at all when the unread count is zero', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(0);
    render(<NotificationBell />);

    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows the real unread count once fetched', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(3);
    render(<NotificationBell />);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('caps the displayed badge at "99+" rather than an unbounded real number', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(150);
    render(<NotificationBell />);

    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('increments the count by exactly one on a real incoming realtime ping', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(2);
    let onPing: ((ping: unknown) => void) | undefined;
    subscribeToNotificationStream.mockImplementation((ping) => {
      onPing = ping;
      return () => {};
    });
    render(<NotificationBell />);
    await screen.findByText('2');

    onPing?.(undefined);
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('shows the real live indicator only once the stream reports status live', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(0);
    let onStatus: ((s: string) => void) | undefined;
    subscribeToNotificationStream.mockImplementation((_ping: unknown, status: (s: string) => void) => {
      onStatus = status;
      return () => {};
    });
    const { container } = render(<NotificationBell />);
    await waitFor(() => expect(subscribeToNotificationStream).toHaveBeenCalled());

    expect(container.querySelector('.bg-up')).not.toBeInTheDocument();
    onStatus?.('live');
    await waitFor(() => expect(container.querySelector('.bg-up')).toBeInTheDocument());
  });

  it('opens the dropdown on click and closes it again on a second click', async () => {
    hasStoredSession.mockReturnValue(false);
    const user = userEvent.setup();
    render(<NotificationBell />);

    // The toggle button and the dropdown panel share the same "Notifications" aria-label,
    // so the panel's presence is checked via the mocked list content instead — unambiguous.
    expect(screen.queryByTestId('notification-list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByTestId('notification-list')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.queryByTestId('notification-list')).not.toBeInTheDocument();
  });

  it('closes the dropdown on a real click outside it', async () => {
    hasStoredSession.mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <NotificationBell />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByTestId('notification-list')).toBeInTheDocument();

    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByTestId('notification-list')).not.toBeInTheDocument();
  });

  it('closes the dropdown on Escape', async () => {
    hasStoredSession.mockReturnValue(false);
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByTestId('notification-list')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('notification-list')).not.toBeInTheDocument();
  });

  it('only shows "Mark all read" when there is a real unread count', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(0);
    const user = userEvent.setup();
    render(<NotificationBell />);
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });

  it('marking all read calls the real endpoint and resets the count to zero', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(5);
    markAllNotificationsRead.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<NotificationBell />);
    await screen.findByText('5');

    await user.click(screen.getByRole('button', { name: /Notifications, 5 unread/ }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(markAllNotificationsRead).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('5')).not.toBeInTheDocument());
  });

  it('leaves the count unchanged, not zeroed, when marking all read fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchUnreadCount.mockResolvedValue(5);
    markAllNotificationsRead.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<NotificationBell />);
    await screen.findByText('5');

    await user.click(screen.getByRole('button', { name: /Notifications, 5 unread/ }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled());
    expect(screen.getByText('5')).toBeInTheDocument(); // never silently zeroed on a failed request
  });
});
