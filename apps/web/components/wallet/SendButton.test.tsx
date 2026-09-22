import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SendButton } from './SendButton';

const { sendModalProps } = vi.hoisted(() => ({ sendModalProps: vi.fn() }));
vi.mock('./SendModal', () => ({
  SendModal: (props: { open: boolean; onClose: () => void }) => {
    sendModalProps(props);
    return props.open ? <div data-testid="send-modal" /> : null;
  },
}));

describe('SendButton', () => {
  it('renders the modal closed by default', () => {
    render(<SendButton />);
    expect(screen.queryByTestId('send-modal')).not.toBeInTheDocument();
  });

  it('opens the modal on click', async () => {
    const user = userEvent.setup();
    render(<SendButton />);

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByTestId('send-modal')).toBeInTheDocument();
  });
});
