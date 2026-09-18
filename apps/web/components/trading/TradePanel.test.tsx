import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeQuoteDto, TradeTransactionDto } from '@kamby/domain';
import type { WalletVerificationStatus } from '@/hooks/useWalletVerification';
import type * as AmountInputModule from './AmountInput';
import { TradePanel } from './TradePanel';

const WALLET_ADDRESS = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 8453;

const {
  useAccountMock,
  sendTransactionMock,
  writeContractMock,
  useWalletVerificationMock,
  verifyMock,
  getQuoteMock,
  getTransactionMock,
  submitTransactionMock,
  submitFeeTransactionMock,
} = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  writeContractMock: vi.fn(),
  useWalletVerificationMock: vi.fn(),
  verifyMock: vi.fn(),
  getQuoteMock: vi.fn(),
  getTransactionMock: vi.fn(),
  submitTransactionMock: vi.fn(),
  submitFeeTransactionMock: vi.fn(),
}));

vi.mock('wagmi', () => ({ useAccount: useAccountMock }));
vi.mock('wagmi/actions', () => ({ sendTransaction: sendTransactionMock, writeContract: writeContractMock }));
vi.mock('@/lib/wagmi-config', () => ({ wagmiConfig: {} }));
vi.mock('@/hooks/useWalletVerification', () => ({ useWalletVerification: useWalletVerificationMock }));
vi.mock('@/lib/trading-client', () => ({
  getQuote: getQuoteMock,
  getTransaction: getTransactionMock,
  submitTransaction: submitTransactionMock,
  submitFeeTransaction: submitFeeTransactionMock,
}));
vi.mock('@/components/wallet/ConnectWalletButton', () => ({ ConnectWalletButton: () => null }));
// AmountInput reads the connected wallet's real balance live via wagmi's useBalance — out
// of scope here (this file drives `amount` directly), same stubbing convention
// SolanaTradePanel.test.tsx already uses for its own amount inputs.
vi.mock('./AmountInput', async () => {
  const actual = await vi.importActual<typeof AmountInputModule>('./AmountInput');
  return {
    ...actual,
    AmountInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      // eslint-disable-next-line jsx-a11y/no-redundant-roles
      <input aria-label="Amount" value={value} onChange={(event) => onChange(event.target.value)} />
    ),
  };
});

function fakeQuote(overrides: Partial<TradeQuoteDto> = {}): TradeQuoteDto {
  return {
    id: 'quote-1',
    chainId: CHAIN_ID,
    side: 'BUY',
    token: { address: '0xaaa', symbol: 'FOO', decimals: 18 },
    quoteToken: { address: '0xbbb', symbol: 'USDC', decimals: 6 },
    inputAmount: '1000000',
    expectedOutputAmount: '100000000000000000000',
    minOutputAmount: '99500000000000000000',
    inputAmountFormatted: '1.0',
    expectedOutputAmountFormatted: '100.0',
    minOutputAmountFormatted: '99.5',
    priceUsd: 2.5,
    priceImpactBps: 42,
    priceImpactLevel: 'normal',
    slippageBps: 50,
    platformFeeBps: 200,
    platformFeeAmount: '20000',
    platformFeeAmountFormatted: '0.02',
    provider: 'kyberswap',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    createdAt: new Date().toISOString(),
    unsignedTx: { to: '0xdead', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    feeUnsignedTx: null,
    safetyNote: 'No known issues detected by available checks.',
    requiresApproval: false,
    approvalSpender: null,
    ...overrides,
  };
}

function fakeTransaction(overrides: Partial<TradeTransactionDto> = {}): TradeTransactionDto {
  return {
    id: 'tx-1',
    chainId: CHAIN_ID,
    txHash: `0x${'1'.repeat(64)}`,
    side: 'BUY',
    token: { address: '0xaaa', symbol: 'FOO', decimals: 18 },
    quoteToken: { address: '0xbbb', symbol: 'USDC', decimals: 6 },
    inputAmount: '1000000',
    expectedOutputAmount: '100000000000000000000',
    inputAmountFormatted: '1.0',
    expectedOutputAmountFormatted: '100.0',
    platformFeeAmount: '20000',
    platformFeeAmountFormatted: '0.02',
    status: 'PENDING',
    failureReason: null,
    submittedAt: new Date().toISOString(),
    confirmedAt: null,
    feeTxHash: null,
    feeStatus: null,
    feeFailureReason: null,
    feeConfirmedAt: null,
    ...overrides,
  };
}

async function fillAmountAndWaitForQuote() {
  await userEvent.type(screen.getByLabelText('Amount'), '1');
  await waitFor(() => expect(getQuoteMock).toHaveBeenCalled(), { timeout: 3000 });
}

const defaultProps = {
  chainId: CHAIN_ID,
  tokenAddress: '0xaaa',
  tokenSymbol: 'FOO',
  tokenDecimals: 18,
  quoteTokenAddress: '0xbbb',
  quoteTokenSymbol: 'USDC',
  quoteTokenDecimals: 6,
};

describe('TradePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountMock.mockReturnValue({ address: WALLET_ADDRESS, isConnected: true, chainId: CHAIN_ID });
    useWalletVerificationMock.mockReturnValue({
      status: 'verified' as WalletVerificationStatus,
      error: null,
      verify: verifyMock,
    });
    getTransactionMock.mockResolvedValue(null);
  });

  async function driveToReview(quote: TradeQuoteDto) {
    getQuoteMock.mockResolvedValue(quote);
    render(<TradePanel {...defaultProps} />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Review trade' }));
  }

  it('shows the up-to-3-signature disclosure when both approval and a guaranteed-USDC fee apply', async () => {
    await driveToReview(fakeQuote({ requiresApproval: true, approvalSpender: '0xrouter', feeUnsignedTx: { to: '0xfee', data: '0x', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null } }));

    expect(screen.getByText(/up to 3 quick wallet approvals/i)).toBeInTheDocument();
  });

  it('shows the 2-signature disclosure when only the guaranteed-USDC fee applies (token already approved)', async () => {
    await driveToReview(fakeQuote({ requiresApproval: false, feeUnsignedTx: { to: '0xfee', data: '0x', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null } }));

    expect(screen.getByText(/2 quick wallet approvals/i)).toBeInTheDocument();
  });

  it('shows no disclosure at all for a trade with no guaranteed-USDC fee', async () => {
    await driveToReview(fakeQuote({ feeUnsignedTx: null }));

    expect(screen.queryByText(/quick wallet approvals/i)).not.toBeInTheDocument();
  });

  it('real 1-click: after the swap is recorded, the fee-transfer signature fires automatically with no extra click', async () => {
    const quote = fakeQuote({
      requiresApproval: false,
      feeUnsignedTx: { to: '0xfee', data: '0xfeedata', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    });
    await driveToReview(quote);

    sendTransactionMock
      .mockResolvedValueOnce(`0x${'2'.repeat(64)}`) // the swap
      .mockResolvedValueOnce(`0x${'3'.repeat(64)}`); // the fee transfer — never clicked, only awaited
    submitTransactionMock.mockResolvedValue(fakeTransaction());
    submitFeeTransactionMock.mockResolvedValue(fakeTransaction({ feeTxHash: `0x${'3'.repeat(64)}`, feeStatus: 'PENDING' }));

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & sign' }));

    // The swap signature happens first...
    await waitFor(() => expect(submitTransactionMock).toHaveBeenCalledWith(expect.objectContaining({ quoteId: quote.id })));
    // ...and the fee signature follows on its own, with no "Send platform fee" click.
    await waitFor(() => expect(sendTransactionMock).toHaveBeenCalledTimes(2));
    expect(sendTransactionMock).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ data: '0xfeedata' }));
    await waitFor(() => expect(submitFeeTransactionMock).toHaveBeenCalledWith('tx-1', `0x${'3'.repeat(64)}`));
  });

  it('falls back to the manual "Send platform fee" button when the auto-fired fee signature is rejected', async () => {
    const quote = fakeQuote({
      requiresApproval: false,
      feeUnsignedTx: { to: '0xfee', data: '0xfeedata', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    });
    await driveToReview(quote);

    sendTransactionMock
      .mockResolvedValueOnce(`0x${'2'.repeat(64)}`) // the swap succeeds
      .mockRejectedValueOnce(new Error('User rejected the request')); // the auto-fired fee signature is rejected
    submitTransactionMock.mockResolvedValue(fakeTransaction());

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & sign' }));

    // The swap itself is never affected — still shows a real trade in flight.
    expect(await screen.findByText(/waiting for confirmation on-chain/i)).toBeInTheDocument();
    // The manual fallback appears, with the real rejection surfaced, never a silent retry.
    expect(await screen.findByRole('button', { name: 'Send platform fee' })).toBeInTheDocument();
    expect(screen.getByText(/User rejected the request/i)).toBeInTheDocument();
    expect(submitFeeTransactionMock).not.toHaveBeenCalled();
  });

  it('never auto-fires a fee signature for a trade with no guaranteed-USDC fee', async () => {
    const quote = fakeQuote({ requiresApproval: false, feeUnsignedTx: null });
    await driveToReview(quote);

    sendTransactionMock.mockResolvedValueOnce(`0x${'2'.repeat(64)}`);
    submitTransactionMock.mockResolvedValue(fakeTransaction());

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & sign' }));

    await waitFor(() => expect(submitTransactionMock).toHaveBeenCalled());
    expect(sendTransactionMock).toHaveBeenCalledTimes(1);
    expect(submitFeeTransactionMock).not.toHaveBeenCalled();
  });
});
