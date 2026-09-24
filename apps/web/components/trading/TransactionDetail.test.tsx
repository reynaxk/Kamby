import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeTransactionDto } from '@kamby/domain';
import { TransactionDetail } from './TransactionDetail';

const { getTransaction } = vi.hoisted(() => ({ getTransaction: vi.fn() }));
vi.mock('@/lib/trading-client', () => ({ getTransaction }));

const BASE_CHAIN_ID = 8453; // real eip155:8453 — resolves to a real Basescan explorer link
const UNMAPPED_CHAIN_ID = 999_999; // no explorer entry — must never render a broken link

function fakeTransaction(overrides: Partial<TradeTransactionDto> = {}): TradeTransactionDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainId: BASE_CHAIN_ID,
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

describe('TransactionDetail', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a real loading skeleton before the first fetch resolves', () => {
    getTransaction.mockReturnValue(new Promise(() => {}));
    const { container } = render(<TransactionDetail id="tx-1" />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows a real not-found state, distinct from a generic error, when the API returns null', async () => {
    getTransaction.mockResolvedValue(null);
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText('Trade not found.')).toBeInTheDocument();
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    getTransaction.mockRejectedValue(new Error('network error'));
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText("Couldn't load this trade.")).toBeInTheDocument();
  });

  it('for a BUY, shows the input as the quote token and the output/fee as the bought token', async () => {
    getTransaction.mockResolvedValue(fakeTransaction({ side: 'BUY' }));
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText('Bought FOO')).toBeInTheDocument();
    expect(screen.getByText('1.0 WETH')).toBeInTheDocument(); // paid in the quote token
    expect(screen.getByText('500.0 FOO')).toBeInTheDocument(); // received the bought token
    expect(screen.getByText('0.01 FOO')).toBeInTheDocument(); // fee denominated in the bought token
  });

  it('for a SELL, swaps which token is the input vs. the output/fee', async () => {
    getTransaction.mockResolvedValue(fakeTransaction({ side: 'SELL' }));
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText('Sold FOO')).toBeInTheDocument();
    expect(screen.getByText('1.0 FOO')).toBeInTheDocument(); // paid the sold token
    expect(screen.getByText('500.0 WETH')).toBeInTheDocument(); // received the quote token
    expect(screen.getByText('0.01 WETH')).toBeInTheDocument();
  });

  it('falls back to a truncated address for the header when the token has no real symbol', async () => {
    getTransaction.mockResolvedValue(
      fakeTransaction({ token: { address: '0x1234567890123456789012345678901234567890', symbol: null, decimals: 18 } }),
    );
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText('Bought 0x1234…7890')).toBeInTheDocument();
  });

  it('only shows a real Confirmed row when confirmedAt is actually present', async () => {
    // status: PENDING here, not the default CONFIRMED — the StatusPill badge itself renders
    // the literal text "Confirmed" for that status, which would collide with this row's own
    // label and make the query ambiguous.
    getTransaction.mockResolvedValue(fakeTransaction({ status: 'PENDING', confirmedAt: null }));
    render(<TransactionDetail id="tx-1" />);
    await screen.findByText('Bought FOO');

    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
  });

  it('only shows a real Reason row when failureReason is actually present', async () => {
    getTransaction.mockResolvedValue(fakeTransaction({ status: 'FAILED', failureReason: 'Slippage exceeded' }));
    render(<TransactionDetail id="tx-1" />);

    expect(await screen.findByText('Slippage exceeded')).toBeInTheDocument();
  });

  it('links to the real explorer for a chain that has one, with the correct name and truncated hash', async () => {
    getTransaction.mockResolvedValue(fakeTransaction({ chainId: BASE_CHAIN_ID, txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678' }));
    render(<TransactionDetail id="tx-1" />);

    const link = await screen.findByRole('link', { name: /View 0xabcd…5678 on Basescan/ });
    expect(link).toHaveAttribute('href', 'https://basescan.org/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678');
  });

  it('never renders an explorer link for a chain with no real mapping', async () => {
    getTransaction.mockResolvedValue(fakeTransaction({ chainId: UNMAPPED_CHAIN_ID }));
    render(<TransactionDetail id="tx-1" />);
    await screen.findByText('Bought FOO');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps polling every 4s while the real status is PENDING', async () => {
    // Fake timers scoped to just this test (never combined with userEvent — the same real
    // hang risk CopyAddressButton.test.tsx already documents), and every wait goes through
    // advanceTimersByTimeAsync (which also flushes pending promise microtasks) rather than
    // RTL's screen.findByText/waitFor, whose own internal polling isn't fake-timer-safe here.
    vi.useFakeTimers();
    getTransaction.mockResolvedValue(fakeTransaction({ status: 'PENDING' }));
    render(<TransactionDetail id="tx-1" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTransaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(getTransaction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });

  it('stops polling once the real status resolves away from PENDING', async () => {
    vi.useFakeTimers();
    getTransaction.mockResolvedValueOnce(fakeTransaction({ status: 'PENDING' }));
    getTransaction.mockResolvedValueOnce(fakeTransaction({ status: 'CONFIRMED' }));
    render(<TransactionDetail id="tx-1" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTransaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(getTransaction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(8000); // two more poll windows — must stay silent
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the real result comes back not-found, never hammering a dead id', async () => {
    vi.useFakeTimers();
    getTransaction.mockResolvedValueOnce(fakeTransaction({ status: 'PENDING' }));
    getTransaction.mockResolvedValueOnce(null);
    render(<TransactionDetail id="tx-1" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTransaction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(0); // extra tick — lets React's own scheduler commit the resulting DOM update
    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Trade not found.')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(8000);
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });
});
