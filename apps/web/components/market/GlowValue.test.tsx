import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlowValue } from './GlowValue';

describe('GlowValue', () => {
  it('renders the raw value when no display override is given', () => {
    render(<GlowValue value="50" />);
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders the display override instead of the raw value, while still using the raw value for the flash comparison', () => {
    render(<GlowValue value="50" display="$50.00" />);
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  it('never flashes on the very first render', () => {
    render(<GlowValue value="50" />);
    const el = screen.getByText('50');
    expect(el).not.toHaveClass('bg-up/20');
    expect(el).not.toHaveClass('bg-down/20');
    expect(el).toHaveClass('text-ink-900');
  });

  it('flashes up when the underlying number increases between renders', () => {
    const { rerender } = render(<GlowValue value="50" />);
    rerender(<GlowValue value="60" />);

    expect(screen.getByText('60')).toHaveClass('bg-up/20', 'text-up');
  });

  it('flashes down when the underlying number decreases between renders', () => {
    const { rerender } = render(<GlowValue value="50" />);
    rerender(<GlowValue value="40" />);

    expect(screen.getByText('40')).toHaveClass('bg-down/20', 'text-down');
  });

  it('never flashes when only the display string changes but the real numeric value does not', () => {
    const { rerender } = render(<GlowValue value="50" display="$50.00" />);
    rerender(<GlowValue value="50" display="50.00 USDC" />);

    const el = screen.getByText('50.00 USDC');
    expect(el).not.toHaveClass('bg-up/20');
    expect(el).not.toHaveClass('bg-down/20');
  });

  it('never flashes for a non-numeric value — defensive, not a crash, and never a fabricated direction', () => {
    const { rerender } = render(<GlowValue value="—" />);
    rerender(<GlowValue value="—" />);

    const el = screen.getByText('—');
    expect(el).not.toHaveClass('bg-up/20');
    expect(el).not.toHaveClass('bg-down/20');
    expect(el).toHaveClass('text-ink-900');
  });

  it('forwards a caller-supplied className alongside its own classes', () => {
    render(<GlowValue value="50" className="custom-class" />);
    expect(screen.getByText('50')).toHaveClass('custom-class', 'text-ink-900');
  });
});
