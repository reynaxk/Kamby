import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProfileMenu } from './ProfileMenu';

const { fetchMyProfileMock } = vi.hoisted(() => ({ fetchMyProfileMock: vi.fn() }));
vi.mock('@/lib/profile-client', () => ({ fetchMyProfile: fetchMyProfileMock }));

const ADDRESS = '0x1111111111111111111111111111111111111111';

describe('ProfileMenu', () => {
  it('keeps a way back to setting a username after the onboarding prompt was skipped', async () => {
    fetchMyProfileMock.mockResolvedValue({ username: null, avatarUrl: null });
    render(<ProfileMenu address={ADDRESS} onSignOut={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open your profile menu' }));
    expect(await screen.findByRole('menuitem', { name: /Set your username/ })).toHaveAttribute('href', '/account#profile');
    expect(screen.getByRole('menuitem', { name: /Edit profile/ })).toHaveAttribute('href', '/account#profile');
  });

  it('shows the username instead once one is set', async () => {
    fetchMyProfileMock.mockResolvedValue({ username: 'sandy', avatarUrl: null });
    render(<ProfileMenu address={ADDRESS} onSignOut={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open your profile menu' }));
    expect(await screen.findByText('@sandy')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Set your username/ })).not.toBeInTheDocument();
  });
});
