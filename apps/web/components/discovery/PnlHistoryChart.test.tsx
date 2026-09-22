import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PnlHistoryChart } from './PnlHistoryChart';

const { fetchMyPnlHistory, hasStoredSession, useBalanceVisibility } = vi.hoisted(() => ({
  fetchMyPnlHistory: vi.fn(),
  hasStoredSession: vi.fn(),
  useBalanceVisibility: vi.fn(),
}));

vi.mock('@/lib/discovery-client', () => ({ fetchMyPnlHistory, hasStoredSession }));
vi.mock('@/components/account/BalanceVisibilityContext', () => ({ useBalanceVisibility }));

describe('PnlHistoryChart', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a no-session state and never fetches without a stored session', () => {
    hasStoredSession.mockReturnValue(false);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    render(<PnlHistoryChart />);

    expect(screen.getByText(/no pnl history yet/i)).toBeInTheDocument();
    expect(fetchMyPnlHistory).not.toHaveBeenCalled();
  });

  it('shows the real cumulative total for the period, signed', async () => {
    hasStoredSession.mockReturnValue(true);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    fetchMyPnlHistory.mockResolvedValue({
      days: 3,
      points: [
        { date: '2026-01-01', realizedPnlUsd: 20, cumulativeRealizedPnlUsd: 20 },
        { date: '2026-01-02', realizedPnlUsd: -5, cumulativeRealizedPnlUsd: 15 },
        { date: '2026-01-03', realizedPnlUsd: 10, cumulativeRealizedPnlUsd: 25 },
      ],
    });

    render(<PnlHistoryChart days={3} />);

    expect(await screen.findByText('+$25.00')).toBeInTheDocument();
  });

  it('shows a real, honest error state when the fetch fails, not a blank chart', async () => {
    hasStoredSession.mockReturnValue(true);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    fetchMyPnlHistory.mockRejectedValue(new Error('network error'));

    render(<PnlHistoryChart />);

    expect(await screen.findByText(/couldn't load your pnl history/i)).toBeInTheDocument();
  });

  it('blurs the total when balances are hidden', async () => {
    hasStoredSession.mockReturnValue(true);
    useBalanceVisibility.mockReturnValue({ hidden: true });
    fetchMyPnlHistory.mockResolvedValue({
      days: 1,
      points: [{ date: '2026-01-01', realizedPnlUsd: 5, cumulativeRealizedPnlUsd: 5 }],
    });

    render(<PnlHistoryChart days={1} />);

    const value = await screen.findByText('+$5.00');
    expect(value.className).toMatch(/blur/);
  });
});
