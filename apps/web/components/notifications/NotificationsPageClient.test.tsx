import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPageClient } from './NotificationsPageClient';

const { markAllNotificationsRead, hasStoredSession } = vi.hoisted(() => ({
  markAllNotificationsRead: vi.fn(),
  hasStoredSession: vi.fn(),
}));

vi.mock('@/lib/notifications-client', () => ({ markAllNotificationsRead }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));
// Both child panels have their own real fetch/render logic tested separately — this file
// isolates NotificationsPageClient's own orchestration (button gating, refreshKey passthrough).
vi.mock('./NotificationList', () => ({
  NotificationList: ({ refreshKey }: { refreshKey: number }) => <div data-testid="list">refreshKey:{refreshKey}</div>,
}));
vi.mock('./NotificationPreferences', () => ({
  NotificationPreferencesPanel: () => <div data-testid="prefs" />,
}));

describe('NotificationsPageClient', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never shows Mark all read when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<NotificationsPageClient />);

    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });

  it('shows Mark all read when there is a real stored session', () => {
    hasStoredSession.mockReturnValue(true);
    render(<NotificationsPageClient />);

    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
  });

  it('always renders both the list and the preferences panel regardless of session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<NotificationsPageClient />);

    expect(screen.getByTestId('list')).toBeInTheDocument();
    expect(screen.getByTestId('prefs')).toBeInTheDocument();
  });

  it('bumps the real refreshKey passed to NotificationList only after mark-all succeeds', async () => {
    hasStoredSession.mockReturnValue(true);
    let resolveMark: () => void = () => {};
    markAllNotificationsRead.mockReturnValue(new Promise<void>((resolve) => (resolveMark = resolve)));
    const user = userEvent.setup();
    render(<NotificationsPageClient />);
    expect(screen.getByTestId('list')).toHaveTextContent('refreshKey:0');

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByTestId('list')).toHaveTextContent('refreshKey:0'); // not yet — still in flight

    resolveMark();
    await waitFor(() => expect(screen.getByTestId('list')).toHaveTextContent('refreshKey:1'));
  });

  it('disables Mark all read only while the request is in flight', async () => {
    hasStoredSession.mockReturnValue(true);
    let resolveMark: () => void = () => {};
    markAllNotificationsRead.mockReturnValue(new Promise<void>((resolve) => (resolveMark = resolve)));
    const user = userEvent.setup();
    render(<NotificationsPageClient />);
    const button = screen.getByRole('button', { name: 'Mark all read' });

    await user.click(button);
    expect(button).toBeDisabled();

    resolveMark();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('re-enables Mark all read even when the request fails, never leaving it stuck', async () => {
    hasStoredSession.mockReturnValue(true);
    markAllNotificationsRead.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<NotificationsPageClient />);
    const button = screen.getByRole('button', { name: 'Mark all read' });

    await user.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByTestId('list')).toHaveTextContent('refreshKey:0'); // never bumped on failure
  });
});
