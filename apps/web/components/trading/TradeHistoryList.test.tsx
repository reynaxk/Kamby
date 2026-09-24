import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeTransactionDto } from '@kamby/domain';
import { TradeHistoryList } from './TradeHistoryList';

const { getTradeHistory, hasStoredSession } = vi.hoisted(() => ({
  getTradeHistory: vi.fn(),
  hasStoredSession: vi.fn(),
}));
vi.mock('@/lib/trading-client', () => ({ getTradeHistory }));
vi.mock('@/lib/session-client', () => ({ hasStoredSession }));

function fakeTransaction(overrides: Partial<TradeTransactionDto> = {}): TradeTransactionDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainId: 8453,
    txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    side: 'BUY',
    token: { address: '0xtoken', symbol: 'FOO', decimals: 18 },
    quoteToken: { address: '0xquote', symbol: 'WETH', decimals: 18 },
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '500000000000000000000',
    inputAmountFormatted: '1.0',
    expectedOutputAmountFormatted: '500.0',
    platformFeeAmount: '10000000000000000',
    platformFeeAmountFormatted: '0.01',
    status: 'CONFIRMED',
    failureReason: null,
    submittedAt: '2026-09-20T12:00:00.000Z',
    confirmedAt: null,
    feeTxHash: null,
    feeStatus: null,
    feeFailureReason: null,
    feeConfirmedAt: null,
    sponsoredByRelayer: false,
    relayerFeePayer: null,
    ...overrides,
  };
}

describe('TradeHistoryList', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real no-session empty state and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    render(<TradeHistoryList />);

    expect(screen.getByText('No trades yet.')).toBeInTheDocument();
    expect(getTradeHistory).not.toHaveBeenCalled();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockRejectedValue(new Error('network error'));
    render(<TradeHistoryList />);

    expect(await screen.findByText("Couldn't load your trade history.")).toBeInTheDocument();
  });

  it('shows a real distinct empty state once loaded with zero trades, not stuck loading', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({ items: [], nextCursor: null });
    render(<TradeHistoryList />);

    expect(await screen.findByText('Your BUY/SELL trades will show up here once you make one.')).toBeInTheDocument();
  });

  it('shows "Bought" in the up color for a real BUY trade', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({ items: [fakeTransaction({ side: 'BUY' })], nextCursor: null });
    render(<TradeHistoryList />);

    const label = await screen.findByText('Bought');
    expect(label).toHaveClass('text-up');
  });

  it('shows "Sold" in the down color for a real SELL trade', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({ items: [fakeTransaction({ side: 'SELL' })], nextCursor: null });
    render(<TradeHistoryList />);

    const label = await screen.findByText('Sold');
    expect(label).toHaveClass('text-down');
  });

  it('shows the real output amount, symbol, date, and status for each trade', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({
      items: [fakeTransaction({ expectedOutputAmountFormatted: '123.4', token: { address: '0xtoken', symbol: 'PEPE', decimals: 18 }, status: 'PENDING' })],
      nextCursor: null,
    });
    render(<TradeHistoryList />);

    expect(await screen.findByText('123.4 PEPE')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it("links each real trade to its own detail page", async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({ items: [fakeTransaction({ id: 'tx-123' })], nextCursor: null });
    render(<TradeHistoryList />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/trades/tx-123');
  });

  it('never shows Load more when there is no real next cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory.mockResolvedValue({ items: [fakeTransaction()], nextCursor: null });
    render(<TradeHistoryList />);
    await screen.findByRole('link');

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('appends the real next page on Load more and forwards the real cursor', async () => {
    hasStoredSession.mockReturnValue(true);
    getTradeHistory
      .mockResolvedValueOnce({ items: [fakeTransaction({ id: 'tx-a' })], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [fakeTransaction({ id: 'tx-b' })], nextCursor: null });
    const user = userEvent.setup();
    render(<TradeHistoryList />);
    await screen.findByRole('link');

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await vi.waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2));
    expect(getTradeHistory).toHaveBeenLastCalledWith({ cursor: 'cursor-1', limit: 20 });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
