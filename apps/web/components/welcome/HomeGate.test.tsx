import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeGate } from './HomeGate';

const { usePrivyMock } = vi.hoisted(() => ({ usePrivyMock: vi.fn() }));

vi.mock('@privy-io/react-auth', () => ({ usePrivy: usePrivyMock }));
vi.mock('./WelcomePage', () => ({ WelcomePage: () => <div data-testid="welcome-page" /> }));

describe('HomeGate', () => {
  it('shows a loading state, not the welcome page or the children, while Privy is still resolving', () => {
    usePrivyMock.mockReturnValue({ ready: false, authenticated: false });
    render(
      <HomeGate>
        <div data-testid="terminal" />
      </HomeGate>,
    );

    expect(screen.queryByTestId('welcome-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
  });

  it('shows the welcome page, not the children, once resolved but not signed in', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false });
    render(
      <HomeGate>
        <div data-testid="terminal" />
      </HomeGate>,
    );

    expect(screen.getByTestId('welcome-page')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
  });

  it('shows the real children, not the welcome page, once signed in', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true });
    render(
      <HomeGate>
        <div data-testid="terminal" />
      </HomeGate>,
    );

    expect(screen.getByTestId('terminal')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-page')).not.toBeInTheDocument();
  });
});
