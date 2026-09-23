import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('shows "no history," not a fake flat line, for fewer than 2 points', () => {
    render(<Sparkline closes={[]} />);
    expect(screen.getByText('no history')).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });

  it('also shows "no history" for exactly one point — a single price has no trend to draw', () => {
    render(<Sparkline closes={[10]} />);
    expect(screen.getByText('no history')).toBeInTheDocument();
  });

  it('maps two real prices to the exact expected SVG coordinates, y-axis correctly inverted (higher price = lower y)', () => {
    render(<Sparkline closes={[10, 20]} />);
    const polyline = document.querySelector('polyline');
    // min=10, max=20, range=10, stepX=(96-4)/1=92. Point 0 (price 10, the low): x=2.0,
    // y=30.0 (near the bottom of the 32-tall viewBox). Point 1 (price 20, the high):
    // x=94.0, y=2.0 (near the top) — a real, hand-computed check, not just "renders
    // something."
    expect(polyline).toHaveAttribute('points', '2.0,30.0 94.0,2.0');
  });

  it('never produces NaN coordinates for a real flat line (every price identical)', () => {
    render(<Sparkline closes={[15, 15, 15]} />);
    const polyline = document.querySelector('polyline');
    // range would be 0 without the `|| 1` fallback, dividing by zero into NaN for every y.
    // All three points instead land on the same real y (30.0), a genuine flat line.
    expect(polyline).toHaveAttribute('points', '2.0,30.0 48.0,30.0 94.0,30.0');
    expect(polyline?.getAttribute('points')).not.toContain('NaN');
  });

  it('colors the line by the overall trend (last price vs first), not point-to-point wiggling', () => {
    const { rerender } = render(<Sparkline closes={[10, 5, 8, 20]} />); // dips then ends higher than it started
    expect(document.querySelector('polyline')).toHaveClass('stroke-up');

    rerender(<Sparkline closes={[20, 25, 18, 10]} />); // spikes then ends lower than it started
    expect(document.querySelector('polyline')).toHaveClass('stroke-down');
  });

  it('colors the line neutral when the price round-trips back to exactly where it started', () => {
    render(<Sparkline closes={[10, 15, 10]} />);
    expect(document.querySelector('polyline')).toHaveClass('stroke-ink-400');
  });
});
