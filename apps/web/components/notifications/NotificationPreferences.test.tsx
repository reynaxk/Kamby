import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPreferences } from '@kamby/domain';
import { NotificationPreferencesPanel } from './NotificationPreferences';

const { fetchNotificationPreferences, updateNotificationPreferences, hasStoredSession } = vi.hoisted(() => ({
  fetchNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  hasStoredSession: vi.fn(),
}));

vi.mock('@/lib/notifications-client', () => ({ fetchNotificationPreferences, updateNotificationPreferences }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));

function fakePrefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    follows: true,
    likes: true,
    followedTraderTrades: false,
    whaleTrades: false,
    trendingTokens: true,
    watchedTokenActivity: false,
    ...overrides,
  };
}

describe('NotificationPreferencesPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real sign-in prompt and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<NotificationPreferencesPanel />);

    expect(screen.getByText('Verify a wallet to manage preferences.')).toBeInTheDocument();
    expect(fetchNotificationPreferences).not.toHaveBeenCalled();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockRejectedValue(new Error('network error'));
    render(<NotificationPreferencesPanel />);

    expect(await screen.findByText("Couldn't load your preferences.")).toBeInTheDocument();
  });

  it('renders all six real toggles with their real server-reported checked state', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockResolvedValue(fakePrefs({ follows: true, likes: false }));
    render(<NotificationPreferencesPanel />);

    const follows = await screen.findByRole('switch', { name: 'New followers' });
    expect(follows).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Likes' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });

  it('flips the real toggle optimistically before the request resolves', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockResolvedValue(fakePrefs({ likes: true }));
    let resolveUpdate: (v: NotificationPreferences) => void = () => {};
    updateNotificationPreferences.mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)));
    const user = userEvent.setup();
    render(<NotificationPreferencesPanel />);
    const likes = await screen.findByRole('switch', { name: 'Likes' });
    expect(likes).toHaveAttribute('aria-checked', 'true');

    await user.click(likes);
    expect(likes).toHaveAttribute('aria-checked', 'false'); // flipped before the request even resolves

    resolveUpdate(fakePrefs({ likes: false }));
    await waitFor(() => expect(likes).not.toBeDisabled());
  });

  it('adopts the real full server response on success, not just the toggled key', async () => {
    // updateNotificationPreferences returns the server's whole authoritative object — a
    // second field could legitimately differ from what was optimistically assumed, and the
    // panel must reflect that real response rather than only patching the one key it sent.
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockResolvedValue(fakePrefs({ likes: true, whaleTrades: false }));
    updateNotificationPreferences.mockResolvedValue(fakePrefs({ likes: false, whaleTrades: true }));
    const user = userEvent.setup();
    render(<NotificationPreferencesPanel />);
    const likes = await screen.findByRole('switch', { name: 'Likes' });

    await user.click(likes);

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Whale trades' })).toHaveAttribute('aria-checked', 'true'));
    expect(updateNotificationPreferences).toHaveBeenCalledWith({ likes: false });
  });

  it('reverts the optimistic flip when the save request fails', async () => {
    // Rejection is deliberately deferred rather than an immediate mockRejectedValue — an
    // instantly-settled promise can resolve within userEvent.click's own await, making the
    // "still optimistic" assertion below flaky since the revert would already have run.
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockResolvedValue(fakePrefs({ likes: true }));
    let rejectUpdate: (e: Error) => void = () => {};
    updateNotificationPreferences.mockReturnValue(new Promise((_resolve, reject) => (rejectUpdate = reject)));
    const user = userEvent.setup();
    render(<NotificationPreferencesPanel />);
    const likes = await screen.findByRole('switch', { name: 'Likes' });

    await user.click(likes);
    expect(likes).toHaveAttribute('aria-checked', 'false');

    rejectUpdate(new Error('network error'));
    await waitFor(() => expect(likes).toHaveAttribute('aria-checked', 'true')); // reverted, not left wrong
  });

  it('disables only the toggle being saved, leaving the rest interactive', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchNotificationPreferences.mockResolvedValue(fakePrefs({ likes: true, follows: true }));
    updateNotificationPreferences.mockReturnValue(new Promise(() => {})); // never resolves
    const user = userEvent.setup();
    render(<NotificationPreferencesPanel />);
    const likes = await screen.findByRole('switch', { name: 'Likes' });
    const follows = screen.getByRole('switch', { name: 'New followers' });

    await user.click(likes);

    expect(likes).toBeDisabled();
    expect(follows).not.toBeDisabled();
  });
});
