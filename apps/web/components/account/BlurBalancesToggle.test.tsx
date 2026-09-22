import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlurBalancesToggle } from './BlurBalancesToggle';

const { useBalanceVisibility } = vi.hoisted(() => ({ useBalanceVisibility: vi.fn() }));
vi.mock('./BalanceVisibilityContext', () => ({ useBalanceVisibility }));

describe('BlurBalancesToggle', () => {
  it('shows "Hide balances" when currently visible', () => {
    useBalanceVisibility.mockReturnValue({ hidden: false, toggle: vi.fn() });
    render(<BlurBalancesToggle />);
    expect(screen.getByRole('button', { name: 'Hide balances' })).toBeInTheDocument();
  });

  it('shows "Show balances" when currently hidden', () => {
    useBalanceVisibility.mockReturnValue({ hidden: true, toggle: vi.fn() });
    render(<BlurBalancesToggle />);
    expect(screen.getByRole('button', { name: 'Show balances' })).toBeInTheDocument();
  });

  it('calls toggle on click', async () => {
    const toggle = vi.fn();
    useBalanceVisibility.mockReturnValue({ hidden: false, toggle });
    const user = userEvent.setup();
    render(<BlurBalancesToggle />);

    await user.click(screen.getByRole('button'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
