import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FundButton } from './FundButton';

const { fundModalProps } = vi.hoisted(() => ({ fundModalProps: vi.fn() }));
vi.mock('./FundModal', () => ({
  FundModal: (props: { open: boolean; onClose: () => void }) => {
    fundModalProps(props);
    return props.open ? <div data-testid="fund-modal" /> : null;
  },
}));

describe('FundButton', () => {
  it('renders the modal closed by default', () => {
    render(<FundButton />);
    expect(screen.queryByTestId('fund-modal')).not.toBeInTheDocument();
  });

  it('opens the modal on click', async () => {
    const user = userEvent.setup();
    render(<FundButton />);

    await user.click(screen.getByRole('button', { name: 'Fund wallet' }));

    expect(screen.getByTestId('fund-modal')).toBeInTheDocument();
  });

  it('shows visible "Fund wallet" text for the labeled variant (profile page), not just an icon', () => {
    render(<FundButton variant="labeled" />);
    const button = screen.getByRole('button', { name: 'Fund wallet' });
    expect(button).toHaveTextContent('Fund wallet');
  });
});
