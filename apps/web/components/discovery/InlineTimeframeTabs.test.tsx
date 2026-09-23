import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineTimeframeTabs } from './InlineTimeframeTabs';

describe('InlineTimeframeTabs', () => {
  it('renders every real timeframe as its own button', () => {
    render(<InlineTimeframeTabs active="1D" onChange={vi.fn()} />);
    for (const tf of ['1H', '4H', '1D', '1W', '1M']) {
      expect(screen.getByRole('button', { name: tf })).toBeInTheDocument();
    }
  });

  it('styles only the real active tab, not any other', () => {
    render(<InlineTimeframeTabs active="4H" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '4H' })).toHaveClass('bg-accent', 'text-accent-ink');
    expect(screen.getByRole('button', { name: '1D' })).not.toHaveClass('bg-accent');
    expect(screen.getByRole('button', { name: '1H' })).not.toHaveClass('bg-accent');
  });

  it('calls onChange with the exact real timeframe clicked, not just any value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InlineTimeframeTabs active="1D" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '1W' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('1W');
  });

  it('still calls onChange when clicking the already-active tab — a real reselect, not silently ignored', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InlineTimeframeTabs active="1D" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '1D' }));

    expect(onChange).toHaveBeenCalledWith('1D');
  });
});
