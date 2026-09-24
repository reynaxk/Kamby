import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JitoTipControl } from './JitoTipControl';

describe('JitoTipControl', () => {
  it('renders all four real presets', () => {
    render(<JitoTipControl valueLamports={0} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Low' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Medium' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High' })).toBeInTheDocument();
  });

  it('never shows a SOL cost label when the tip is off, since there is no real cost to show', () => {
    render(<JitoTipControl valueLamports={0} onChange={vi.fn()} />);
    expect(screen.queryByText(/SOL$/)).not.toBeInTheDocument();
  });

  it('shows the real lamports amount converted to SOL with three decimal places', () => {
    render(<JitoTipControl valueLamports={5_000_000} onChange={vi.fn()} />);
    expect(screen.getByText('0.005 SOL')).toBeInTheDocument();
  });

  it('marks the real matching preset as active, never a non-matching one', () => {
    render(<JitoTipControl valueLamports={10_000_000} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'High' })).toHaveClass('text-accent');
    expect(screen.getByRole('button', { name: 'Off' })).not.toHaveClass('text-accent');
    expect(screen.getByRole('button', { name: 'Low' })).not.toHaveClass('text-accent');
    expect(screen.getByRole('button', { name: 'Medium' })).not.toHaveClass('text-accent');
  });

  it('marks no preset active for a custom lamports value that matches none of them', () => {
    render(<JitoTipControl valueLamports={2_500_000} onChange={vi.fn()} />);
    for (const label of ['Off', 'Low', 'Medium', 'High']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveClass('text-accent');
    }
  });

  it('calls onChange with the real preset lamports value on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JitoTipControl valueLamports={0} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Medium' }));

    expect(onChange).toHaveBeenCalledWith(5_000_000);
  });

  it('calls onChange with zero lamports when switching back to Off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JitoTipControl valueLamports={10_000_000} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Off' }));

    expect(onChange).toHaveBeenCalledWith(0);
  });
});
