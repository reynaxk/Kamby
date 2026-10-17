import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PulseChat } from './PulseChat';

const { fetchPulse, postPulse, privy, fetchMyProfile } = vi.hoisted(() => ({
  fetchPulse: vi.fn(),
  postPulse: vi.fn(),
  fetchMyProfile: vi.fn(),
  privy: { ready: true, authenticated: false, login: vi.fn() },
}));

vi.mock('@/lib/pulse-client', () => ({ fetchPulse, postPulse, PULSE_STREAM_URL: 'http://x/stream' }));
vi.mock('@/lib/resilient-event-source', () => ({ openResilientEventSource: () => () => {} }));
vi.mock('@/lib/profile-client', () => ({ fetchMyProfile, fetchMyProfileShared: fetchMyProfile }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession: () => true, SESSION_CHANGED_EVENT: 'kamby:session-changed' }));
vi.mock('@privy-io/react-auth', () => ({ usePrivy: () => privy }));

const message = (id: string, body: string) => ({ id, body, createdAt: new Date().toISOString(), author: { username: 'sam', avatarUrl: null, address: '0xabc' } });

describe('PulseChat', () => {
  afterEach(() => {
    vi.clearAllMocks();
    privy.authenticated = false;
  });

  it('shows the latest messages oldest-first with $SYMBOL lit, and a sign-in button when signed out', async () => {
    fetchPulse.mockResolvedValue({ items: [message('2', 'second'), message('1', '$WIF to the moon')], nextBefore: null });
    render(<PulseChat />);
    expect(await screen.findByText('$WIF')).toHaveClass('text-accent');
    const texts = screen.getAllByText(/second|to the moon/).map((n) => n.textContent);
    expect(texts[0]).toContain('to the moon');
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('stops a message with a link before sending it', async () => {
    privy.authenticated = true;
    fetchMyProfile.mockResolvedValue({ username: 'sam', avatarUrl: null });
    fetchPulse.mockResolvedValue({ items: [], nextBefore: null });
    render(<PulseChat />);
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, 'free coins at scam-site.xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(postPulse).not.toHaveBeenCalled();
    expect(screen.getByText(/Links aren't allowed/)).toBeInTheDocument();
  });
});
