import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TradeStatus } from '@kamby/domain';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it.each<[TradeStatus, string]>([
    ['PENDING', 'Pending'],
    ['CONFIRMED', 'Confirmed'],
    ['FAILED', 'Failed'],
    ['EXPIRED', 'Expired'],
  ])('renders the real API status "%s" as "%s"', (status, label) => {
    render(<StatusPill status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('uses the real "up" color for a confirmed trade, never the failure color', () => {
    render(<StatusPill status="CONFIRMED" />);
    expect(screen.getByText('Confirmed')).toHaveClass('text-up');
  });

  it('uses the real "down" color for both failed and expired trades, never the success color', () => {
    const { rerender } = render(<StatusPill status="FAILED" />);
    expect(screen.getByText('Failed')).toHaveClass('text-down');

    rerender(<StatusPill status="EXPIRED" />);
    expect(screen.getByText('Expired')).toHaveClass('text-down');
  });

  it('never colors a pending trade as either success or failure while its outcome is unknown', () => {
    render(<StatusPill status="PENDING" />);
    const pill = screen.getByText('Pending');
    expect(pill).not.toHaveClass('text-up');
    expect(pill).not.toHaveClass('text-down');
  });
});
