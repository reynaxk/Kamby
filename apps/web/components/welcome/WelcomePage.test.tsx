import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomePage } from './WelcomePage';

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock('@privy-io/react-auth', () => ({ usePrivy: () => ({ login: loginMock }) }));

describe('WelcomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the real hero headline and all 6 feature cards', () => {
    render(<WelcomePage />);

    expect(screen.getByText('Your terminal. Your keys. Every chain.')).toBeInTheDocument();
    expect(screen.getByText('Leaderboard & PnL')).toBeInTheDocument();
    expect(screen.getByText('One terminal, three chains')).toBeInTheDocument();
    expect(screen.getByText('Non-custodial by design')).toBeInTheDocument();
    expect(screen.getByText('Live Trenches')).toBeInTheDocument();
    expect(screen.getByText('Send, anywhere')).toBeInTheDocument();
    expect(screen.getByText('Built for speed')).toBeInTheDocument();
  });

  it('calls Privy login from the hero CTA', async () => {
    const user = userEvent.setup();
    render(<WelcomePage />);

    const startTradingButtons = screen.getAllByRole('button', { name: 'Start trading' });
    expect(startTradingButtons).toHaveLength(2); // hero + closing band
    await user.click(startTradingButtons[0]!);
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('calls Privy login from the header Sign in button too', async () => {
    const user = userEvent.setup();
    render(<WelcomePage />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(loginMock).toHaveBeenCalledTimes(1);
  });
});
