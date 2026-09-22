import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileEditor } from './ProfileEditor';

const { fetchMyProfile, updateUsername, uploadAvatar, hasStoredSession, useAccount } = vi.hoisted(() => ({
  fetchMyProfile: vi.fn(),
  updateUsername: vi.fn(),
  uploadAvatar: vi.fn(),
  hasStoredSession: vi.fn(),
  useAccount: vi.fn(),
}));

vi.mock('@/lib/profile-client', () => ({ fetchMyProfile, updateUsername, uploadAvatar }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));
vi.mock('wagmi', () => ({ useAccount }));

describe('ProfileEditor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    useAccount.mockReturnValue({ address: undefined });
  });

  it('prompts to sign in rather than creating a session just to check the profile', () => {
    hasStoredSession.mockReturnValue(false);
    render(<ProfileEditor />);
    expect(screen.getByText(/sign in to edit your profile/i)).toBeInTheDocument();
    expect(fetchMyProfile).not.toHaveBeenCalled();
  });

  it('loads and pre-fills the current username once a session exists', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByDisplayValue('alice')).toBeInTheDocument());
  });

  it('shows a real error, not a crash, when loading the profile fails', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockRejectedValue(new Error('network error'));
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByText(/couldn't load your profile/i)).toBeInTheDocument());
  });

  it('disables Save until the typed username is well-formed', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: null, avatarUrl: null });
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByPlaceholderText('your_handle')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('your_handle');
    const saveButton = screen.getByRole('button', { name: /save/i });

    await user.type(input, 'ab'); // too short
    expect(saveButton).toBeDisabled();

    await user.type(input, 'c'); // now "abc" — valid
    expect(saveButton).toBeEnabled();
  });

  it('saves a valid, normalized username and shows a success message', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: null, avatarUrl: null });
    updateUsername.mockResolvedValue({ username: 'trader_99', avatarUrl: null });
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByPlaceholderText('your_handle')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('your_handle'), 'Trader_99');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateUsername).toHaveBeenCalledWith('trader_99'));
    expect(await screen.findByText(/username saved/i)).toBeInTheDocument();
  });

  it("surfaces the server's own error message on a collision, not a generic failure", async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: null, avatarUrl: null });
    updateUsername.mockRejectedValue(new Error('Username "alice" is already taken.'));
    const user = userEvent.setup();
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByPlaceholderText('your_handle')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('your_handle'), 'alice');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
  });

  it('rejects an oversized avatar client-side before ever calling uploadAvatar', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByText(/upload a picture/i)).toBeInTheDocument());
    const bigFile = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(fileInput, bigFile);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('uploads a valid avatar and shows the resulting image', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    uploadAvatar.mockResolvedValue({ username: 'alice', avatarUrl: 'https://cdn.kambesh.com/a.png' });
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByText(/upload a picture/i)).toBeInTheDocument());
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(file));
    expect(await screen.findByAltText('')).toHaveAttribute('src', 'https://cdn.kambesh.com/a.png');
  });

  it('links to the public trader profile for the connected wallet', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    useAccount.mockReturnValue({ address: '0xABC0000000000000000000000000000000000A' });
    render(<ProfileEditor />);

    const link = await screen.findByRole('link', { name: /view your public profile/i });
    expect(link).toHaveAttribute('href', '/trader/0xABC0000000000000000000000000000000000A');
  });

  it('omits the public-profile link when no wallet is connected', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyProfile.mockResolvedValue({ username: 'alice', avatarUrl: null });
    render(<ProfileEditor />);

    await waitFor(() => expect(screen.getByDisplayValue('alice')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /view your public profile/i })).not.toBeInTheDocument();
  });
});
