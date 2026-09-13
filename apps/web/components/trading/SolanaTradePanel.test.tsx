import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolanaTradeQuoteDto, SolanaTradeTransactionDto } from '@kamby/domain';
import type { SolanaWalletVerificationStatus } from '@/hooks/useSolanaWalletVerification';
import { SolanaTradePanel } from './SolanaTradePanel';

const WALLET_ADDRESS = '8nTncbaJ8gc8ooDWRFt9TKjog7743iHC43iEcesAbAee';

const {
  usePrivyMock,
  useWalletsMock,
  useSignAndSendTransactionMock,
  signAndSendTransaction,
  useSolanaWalletVerificationMock,
  verifyMock,
  loginMock,
  useTerminalToastMock,
  pushMock,
  updateMock,
  getSolanaQuoteMock,
  getSolanaTransactionMock,
  submitSolanaTransactionMock,
} = vi.hoisted(() => {
  const loginMock = vi.fn();
  const verifyMock = vi.fn();
  const signAndSendTransaction = vi.fn();
  const pushMock = vi.fn(() => 'toast-1');
  const updateMock = vi.fn();
  return {
    usePrivyMock: vi.fn(() => ({ ready: true, authenticated: true, login: loginMock })),
    useWalletsMock: vi.fn(() => ({ wallets: [{ address: WALLET_ADDRESS }] })),
    useSignAndSendTransactionMock: vi.fn(() => ({ signAndSendTransaction })),
    signAndSendTransaction,
    useSolanaWalletVerificationMock: vi.fn((): {
      status: SolanaWalletVerificationStatus;
      error: string | null;
      verify: typeof verifyMock;
      isConnected: boolean;
      address: string;
    } => ({
      status: 'verified',
      error: null,
      verify: verifyMock,
      isConnected: true,
      address: WALLET_ADDRESS,
    })),
    verifyMock,
    loginMock,
    useTerminalToastMock: vi.fn(() => ({ push: pushMock, update: updateMock, dismiss: vi.fn() })),
    pushMock,
    updateMock,
    getSolanaQuoteMock: vi.fn(),
    getSolanaTransactionMock: vi.fn(),
    submitSolanaTransactionMock: vi.fn(),
  };
});

vi.mock('@privy-io/react-auth', () => ({ usePrivy: usePrivyMock }));
vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: useWalletsMock,
  useSignAndSendTransaction: useSignAndSendTransactionMock,
}));
vi.mock('@/hooks/useSolanaWalletVerification', () => ({ useSolanaWalletVerification: useSolanaWalletVerificationMock }));
vi.mock('@/components/terminal/ToastProvider', () => ({ useTerminalToast: useTerminalToastMock }));
vi.mock('@/lib/solana-trading-client', () => ({
  getSolanaQuote: getSolanaQuoteMock,
  getSolanaTransaction: getSolanaTransactionMock,
  submitSolanaTransaction: submitSolanaTransactionMock,
}));
vi.mock('@/components/terminal/RpcStatusBar', () => ({ RpcStatusBar: () => null }));
// UsdPresetAmountInput does its own live RPC balance read (@solana/spl-token) — already
// covered by its own test file. Stubbed here to a plain input so this file can drive
// `amount` directly without also mocking @solana/spl-token/solanaConnection.
vi.mock('./UsdPresetAmountInput', async () => {
  const actual = await vi.importActual<typeof import('./UsdPresetAmountInput')>('./UsdPresetAmountInput');
  return {
    ...actual,
    UsdPresetAmountInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      // eslint-disable-next-line jsx-a11y/no-redundant-roles
      <input aria-label="Amount" value={value} onChange={(event) => onChange(event.target.value)} />
    ),
  };
});

function fakeQuote(overrides: Partial<SolanaTradeQuoteDto> = {}): SolanaTradeQuoteDto {
  return {
    id: 'quote-1',
    side: 'BUY',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    inputAmountRaw: '10000000',
    outputAmountRaw: '98600000',
    minOutputAmountRaw: '98100000',
    priceImpactBps: 22,
    platformFeeBps: 50,
    platformFeeAmountRaw: '50000',
    unsignedTxBase64: btoa('fake-unsigned-tx-bytes'),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeTransaction(overrides: Partial<SolanaTradeTransactionDto> = {}): SolanaTradeTransactionDto {
  return {
    id: 'tx-1',
    signature: 'sig123',
    side: 'BUY',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    inputAmount: '10000000',
    expectedOutputAmount: '98600000',
    platformFeeAmount: '50000',
    status: 'PENDING',
    failureReason: null,
    submittedAt: new Date().toISOString(),
    confirmedAt: null,
    ...overrides,
  };
}

async function fillAmountAndWaitForQuote() {
  await userEvent.type(screen.getByLabelText('Amount'), '10000000');
  await waitFor(() => expect(getSolanaQuoteMock).toHaveBeenCalled(), { timeout: 3000 });
}

describe('SolanaTradePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [{ address: WALLET_ADDRESS }] });
    useSolanaWalletVerificationMock.mockReturnValue({
      status: 'verified',
      error: null,
      verify: verifyMock,
      isConnected: true,
      address: WALLET_ADDRESS,
    });
    pushMock.mockReturnValue('toast-1');
    getSolanaTransactionMock.mockResolvedValue(null);
  });

  it('shows a sign-in prompt, never the trade form, when no wallet is connected yet', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [] });
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('sign-in calls Privy login()', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [] });
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('shows a verify prompt, never the trade form, for a connected but unverified wallet', () => {
    useSolanaWalletVerificationMock.mockReturnValue({
      status: 'unverified',
      error: null,
      verify: verifyMock,
      isConnected: true,
      address: WALLET_ADDRESS,
    });
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    expect(screen.getByRole('button', { name: 'Verify wallet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('fetches a real quote after an amount is entered and enables Review once it resolves', async () => {
    getSolanaQuoteMock.mockResolvedValue(fakeQuote());
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);

    await fillAmountAndWaitForQuote();

    expect(await screen.findByRole('button', { name: 'Review buy' })).toBeEnabled();
  });

  it('never enables Review while the quote is still loading or failed', async () => {
    getSolanaQuoteMock.mockRejectedValue(new Error('No live quote is available'));
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);

    await userEvent.type(screen.getByLabelText('Amount'), '10000000');
    await waitFor(() => expect(getSolanaQuoteMock).toHaveBeenCalled(), { timeout: 3000 });

    expect(await screen.findByText('No live quote is available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review buy' })).toBeDisabled();
  });

  it('switching to SELL relabels the review/confirm actions accordingly', async () => {
    getSolanaQuoteMock.mockResolvedValue(fakeQuote({ side: 'SELL' }));
    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);

    await userEvent.click(screen.getByRole('button', { name: /Sell SOL/i }));
    await fillAmountAndWaitForQuote();

    expect(await screen.findByRole('button', { name: 'Review sell' })).toBeEnabled();
  });

  it('confirm & sign broadcasts the real transaction, records it, and shows the submitted state', async () => {
    const quote = fakeQuote();
    getSolanaQuoteMock.mockResolvedValue(quote);
    signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
    submitSolanaTransactionMock.mockResolvedValue(fakeTransaction());

    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Review buy' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & buy' }));

    await waitFor(() =>
      expect(submitSolanaTransactionMock).toHaveBeenCalledWith({
        quoteId: quote.id,
        walletAddress: WALLET_ADDRESS,
        signature: expect.any(String),
      }),
    );
    expect(await screen.findByText('Waiting for confirmation…')).toBeInTheDocument();
  });

  it('keeps the user on the review step and shows the real error if signing is rejected', async () => {
    getSolanaQuoteMock.mockResolvedValue(fakeQuote());
    signAndSendTransaction.mockRejectedValue(new Error('User rejected the request'));

    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Review buy' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & buy' }));

    expect(await screen.findByText('User rejected the request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm & buy' })).toBeInTheDocument();
    expect(submitSolanaTransactionMock).not.toHaveBeenCalled();
  });

  it('never loses a real broadcast signature if recording it afterward fails', async () => {
    getSolanaQuoteMock.mockResolvedValue(fakeQuote());
    signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
    submitSolanaTransactionMock.mockRejectedValue(new Error('network blip'));

    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Review buy' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & buy' }));

    expect(await screen.findByText(/couldn.t record it/i)).toBeInTheDocument();
    const solscanLink = screen.getByRole('link', { name: /View on Solscan/i });
    expect(solscanLink.getAttribute('href')).toMatch(/^https:\/\/solscan\.io\/tx\//);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('Retry after a record-failure resubmits the exact same real signature, not a new one', async () => {
    getSolanaQuoteMock.mockResolvedValue(fakeQuote());
    signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
    submitSolanaTransactionMock.mockRejectedValueOnce(new Error('network blip'));
    submitSolanaTransactionMock.mockResolvedValueOnce(fakeTransaction());

    render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Review buy' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & buy' }));
    await screen.findByRole('button', { name: 'Retry' });

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(submitSolanaTransactionMock).toHaveBeenCalledTimes(2));
    const firstSignature = submitSolanaTransactionMock.mock.calls[0]?.[0]?.signature;
    const secondSignature = submitSolanaTransactionMock.mock.calls[1]?.[0]?.signature;
    expect(secondSignature).toBe(firstSignature);
    expect(await screen.findByText('Waiting for confirmation…')).toBeInTheDocument();
  });

  it(
    'polling picks up a CONFIRMED status and shows the confirmed view with a working Solscan link',
    async () => {
      getSolanaQuoteMock.mockResolvedValue(fakeQuote());
      signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
      submitSolanaTransactionMock.mockResolvedValue(fakeTransaction());
      getSolanaTransactionMock.mockResolvedValue(fakeTransaction({ status: 'CONFIRMED', confirmedAt: new Date().toISOString() }));

      render(<SolanaTradePanel tokenMint="mint" tokenSymbol="SOL" />);
      await fillAmountAndWaitForQuote();
      await userEvent.click(await screen.findByRole('button', { name: 'Review buy' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Confirm & buy' }));
      await screen.findByText('Waiting for confirmation…');

      expect(await screen.findByText('Trade confirmed', {}, { timeout: 5000 })).toBeInTheDocument();
      const solscanLink = screen.getByRole('link', { name: /View on Solscan/i });
      expect(solscanLink.getAttribute('href')).toBe('https://solscan.io/tx/sig123');
    },
    10000,
  );
});
