import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GaslessToggle } from './GaslessToggle';

describe('GaslessToggle', () => {
  it('renders the real caller-supplied label rather than a hardcoded token name', () => {
    render(<GaslessToggle value={false} onChange={vi.fn()} label="No BNB needed" />);
    expect(screen.getByText('No BNB needed')).toBeInTheDocument();
  });

  it('reflects the real off state via aria-pressed', () => {
    render(<GaslessToggle value={false} onChange={vi.fn()} label="Gasless" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects the real on state via aria-pressed', () => {
    render(<GaslessToggle value onChange={vi.fn()} label="Gasless" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onChange with the real inverted value when turning on', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GaslessToggle value={false} onChange={onChange} label="Gasless" />);

    await user.click(screen.getByRole('button'));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with the real inverted value when turning off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GaslessToggle value onChange={onChange} label="Gasless" />);

    await user.click(screen.getByRole('button'));

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('is a controlled component — a click never flips its own displayed state without a new value prop', async () => {
    const user = userEvent.setup();
    render(<GaslessToggle value={false} onChange={vi.fn()} label="Gasless" />);
    const button = screen.getByRole('button');

    await user.click(button);

    expect(button).toHaveAttribute('aria-pressed', 'false'); // still false — the parent owns the real state
  });
});
