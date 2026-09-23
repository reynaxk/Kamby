import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceChange } from './PriceChange';

describe('PriceChange', () => {
  it('colors a positive value up, with the real formatted percent text', () => {
    render(<PriceChange value={5.25} />);
    const el = screen.getByText('+5.25%');
    expect(el).toHaveClass('text-up');
  });

  it('colors a negative value down', () => {
    render(<PriceChange value={-3.1} />);
    expect(screen.getByText('-3.10%')).toHaveClass('text-down');
  });

  it('colors exactly zero flat, neither up nor down', () => {
    render(<PriceChange value={0} />);
    const el = screen.getByText('0.00%');
    expect(el).toHaveClass('text-ink-400');
    expect(el).not.toHaveClass('text-up');
    expect(el).not.toHaveClass('text-down');
  });

  it('never flashes on the very first render — nothing to compare against yet', () => {
    render(<PriceChange value={5} />);
    const el = screen.getByText('+5.00%');
    expect(el).not.toHaveClass('shadow-glow-up');
    expect(el).not.toHaveClass('shadow-glow-down');
  });

  it('flashes up when the value increases between renders, overriding the plain direction color', () => {
    const { rerender } = render(<PriceChange value={5} />);
    rerender(<PriceChange value={6} />);

    const el = screen.getByText('+6.00%');
    expect(el).toHaveClass('shadow-glow-up', 'bg-up/10', 'text-up');
  });

  it('flashes on the real delta direction, not the value\'s own sign — a still-negative value that moved up still flashes up', () => {
    // -5% -> -3% is still negative (direction would say "down"), but the number itself
    // increased — the flash must follow the real delta, not silently reuse the sign color.
    const { rerender } = render(<PriceChange value={-5} />);
    rerender(<PriceChange value={-3} />);

    const el = screen.getByText('-3.00%');
    expect(el).toHaveClass('shadow-glow-up', 'text-up');
    expect(el).not.toHaveClass('text-down');
  });

  it('flashes down when the value decreases between renders', () => {
    const { rerender } = render(<PriceChange value={5} />);
    rerender(<PriceChange value={3} />);

    const el = screen.getByText('+3.00%');
    expect(el).toHaveClass('shadow-glow-down', 'bg-down/10', 'text-down');
  });

  it('never flashes on a re-render with the same value', () => {
    const { rerender } = render(<PriceChange value={5} />);
    rerender(<PriceChange value={5} />);

    const el = screen.getByText('+5.00%');
    expect(el).not.toHaveClass('shadow-glow-up');
    expect(el).not.toHaveClass('shadow-glow-down');
    expect(el).toHaveClass('text-up'); // falls back to the plain direction color
  });

  it('forwards a caller-supplied className alongside its own classes', () => {
    render(<PriceChange value={5} className="custom-class" />);
    expect(screen.getByText('+5.00%')).toHaveClass('custom-class', 'text-up');
  });
});
