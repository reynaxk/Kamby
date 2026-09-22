import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BalanceVisibilityProvider, useBalanceVisibility } from './BalanceVisibilityContext';

function Consumer() {
  const { hidden, toggle } = useBalanceVisibility();
  return (
    <button type="button" onClick={toggle}>
      {hidden ? 'hidden' : 'visible'}
    </button>
  );
}

describe('BalanceVisibilityProvider / useBalanceVisibility', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to visible (not hidden) with nothing stored', () => {
    render(
      <BalanceVisibilityProvider>
        <Consumer />
      </BalanceVisibilityProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('visible');
  });

  it('resolves a previously-stored "hidden" preference after mount', async () => {
    localStorage.setItem('kamby:balances-hidden', 'true');
    render(
      <BalanceVisibilityProvider>
        <Consumer />
      </BalanceVisibilityProvider>,
    );
    expect(await screen.findByText('hidden')).toBeInTheDocument();
  });

  it('toggling flips state for every consumer and persists it', async () => {
    const user = userEvent.setup();
    render(
      <BalanceVisibilityProvider>
        <Consumer />
        <Consumer />
      </BalanceVisibilityProvider>,
    );

    const [first, second] = screen.getAllByRole('button');
    await user.click(first!);

    expect(first).toHaveTextContent('hidden');
    expect(second).toHaveTextContent('hidden'); // same click, both subtrees in sync
    expect(localStorage.getItem('kamby:balances-hidden')).toBe('true');
  });

  it('throws a real error when used outside the provider, rather than silently misbehaving', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/BalanceVisibilityProvider/);
    consoleError.mockRestore();
  });
});
