import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPrompt } from './OnboardingPrompt';

const { fetchMyProfile, hasStoredSession } = vi.hoisted(() => ({
  fetchMyProfile: vi.fn(),
  hasStoredSession: vi.fn(),
}));

vi.mock('@/lib/profile-client', () => ({ fetchMyProfile }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));

describe('OnboardingPrompt', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('never checks the profile at all for a visitor with no session yet', () => {
    hasStoredSession.mockReturnValue(false);
    render(<OnboardingPrompt />);
    expect(fetchMyProfile).not.toHaveBeenCalled();
    expect(screen.queryByText(/set up your profile/i)).not.toBeInTheDocument();
  });

  it('shows the prompt when a real session has no username set', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: null, avatarUrl: null });
    render(<OnboardingPrompt />);

    expect(await screen.findByText(/set up your profile/i)).toBeInTheDocument();
  });

  it('stays silent once the session already has a username set', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    render(<OnboardingPrompt />);

    await waitFor(() => expect(fetchMyProfile).toHaveBeenCalled());
    expect(screen.queryByText(/set up your profile/i)).not.toBeInTheDocument();
  });

  it('never crashes or shows anything if the profile check itself fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockRejectedValue(new Error('network error'));
    render(<OnboardingPrompt />);

    await waitFor(() => expect(fetchMyProfile).toHaveBeenCalled());
    expect(screen.queryByText(/set up your profile/i)).not.toBeInTheDocument();
  });

  it('clicking Skip hides the prompt and remembers the skip for this browser session', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: null, avatarUrl: null });
    const user = userEvent.setup();
    render(<OnboardingPrompt />);

    await screen.findByText(/set up your profile/i);
    await user.click(screen.getByRole('button', { name: /skip/i }));

    expect(screen.queryByText(/set up your profile/i)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('kamby:onboarding-dismissed')).toBe('1');
  });

  it('does not re-check (or re-show) within the same browser session once skipped', () => {
    window.sessionStorage.setItem('kamby:onboarding-dismissed', '1');
    hasStoredSession.mockReturnValue(true);
    render(<OnboardingPrompt />);

    expect(fetchMyProfile).not.toHaveBeenCalled();
  });
});
