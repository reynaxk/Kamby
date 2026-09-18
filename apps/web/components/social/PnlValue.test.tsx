import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PnlValue } from './PnlValue';

describe('PnlValue', () => {
  it('renders a positive PnL with a green (up) treatment and both $ and %', () => {
    render(<PnlValue usd={1240} pct={12.4} />);
    expect(screen.getByText('+$1.2K').parentElement).toHaveClass('text-up');
    expect(screen.getByText('+12.40%')).toBeInTheDocument();
  });

  it('renders a negative PnL with a red (down) treatment', () => {
    render(<PnlValue usd={-803.5} pct={-8.2} />);
    expect(screen.getByText('-$803.50').parentElement).toHaveClass('text-down');
  });

  it('renders an em dash, not a fabricated $0.00, when there is no matched PnL at all', () => {
    render(<PnlValue usd={null} pct={null} />);
    expect(screen.getByText('—').parentElement).toHaveClass('text-ink-400');
  });

  it('omits the % entirely (not "0%") when pct is null but usd is a real number', () => {
    render(<PnlValue usd={0} pct={null} />);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByText('%', { exact: false })).not.toBeInTheDocument();
  });
});
