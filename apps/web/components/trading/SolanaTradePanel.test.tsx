import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolanaTradeQuoteDto, SolanaTradeTransactionDto } from '@kamby/domain';
import type { SolanaWalletVerificationStatus } from '@/hooks/useSolanaWalletVerification';
import type * as SolAmountInputModule from './SolAmountInput';
import { SolanaTradePanel } from './SolanaTradePanel';
import type * as UsdPresetAmountInputModule from './UsdPresetAmountInput';
import { resetEmbeddedWalletCreation, WALLET_CREATION_FALLBACK_DELAY_MS } from '@/lib/embedded-wallet-creation';

const WALLET_ADDRESS = '8nTncbaJ8gc8ooDWRFt9TKjog7743iHC43iEcesAbAee';

const {
  usePrivyMock,
  useWalletsMock,
  useSignAndSendTransactionMock,
  signAndSendTransaction,
  useSignTransactionMock,
  signTransaction,
  useSolanaWalletVerificationMock,
  verifyMock,
  loginMock,
  useTerminalToastMock,
  pushMock,
  updateMock,
  getSolanaQuoteMock,
  getSolanaTransactionMock,
  submitSolanaTransactionMock,
  getSponsoredSolanaQuoteMock,
  submitSponsoredSolanaTransactionMock,
  sendRawTransactionMock,
} = vi.hoisted(() => {
  const loginMock = vi.fn();
  const verifyMock = vi.fn();
  const signAndSendTransaction = vi.fn();
  const signTransaction = vi.fn();
  const pushMock = vi.fn(() => 'toast-1');
  const updateMock = vi.fn();
  return {
    usePrivyMock: vi.fn(() => ({ ready: true, authenticated: true, login: loginMock })),
    useWalletsMock: vi.fn((): { wallets: { address: string }[]; ready?: boolean } => ({ wallets: [{ address: WALLET_ADDRESS }], ready: true })),
    useSignAndSendTransactionMock: vi.fn(() => ({ signAndSendTransaction })),
    signAndSendTransaction,
    useSignTransactionMock: vi.fn(() => ({ signTransaction })),
    signTransaction,
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
    getSponsoredSolanaQuoteMock: vi.fn(),
    submitSponsoredSolanaTransactionMock: vi.fn(),
    sendRawTransactionMock: vi.fn(),
  };
});

vi.mock('@privy-io/react-auth', () => ({ usePrivy: usePrivyMock }));
const { createSolanaWalletMock } = vi.hoisted(() => ({ createSolanaWalletMock: vi.fn().mockResolvedValue({ wallet: {} }) }));
vi.mock('@privy-io/react-auth/solana', () => ({
  useCreateWallet: () => ({ createWallet: createSolanaWalletMock }),
  useWallets: useWalletsMock,
  useSignAndSendTransaction: useSignAndSendTransactionMock,
  useSignTransaction: useSignTransactionMock,
}));
// Only the Jito broadcast path ever constructs a Connection — a real one would attempt a
// genuine network call to Jito's mainnet endpoint from inside a unit test.
vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn().mockImplementation(() => ({ sendRawTransaction: sendRawTransactionMock })),
}));
vi.mock('@/hooks/useSolanaWalletVerification', () => ({ useSolanaWalletVerification: useSolanaWalletVerificationMock }));
vi.mock('@/components/terminal/ToastProvider', () => ({ useTerminalToast: useTerminalToastMock }));
vi.mock('@/lib/solana-trading-client', () => ({
  getSolanaQuote: getSolanaQuoteMock,
  getSolanaTransaction: getSolanaTransactionMock,
  submitSolanaTransaction: submitSolanaTransactionMock,
  getSponsoredSolanaQuote: getSponsoredSolanaQuoteMock,
  submitSponsoredSolanaTransaction: submitSponsoredSolanaTransactionMock,
}));
// UsdPresetAmountInput does its own live RPC balance read (@solana/spl-token) — already
// covered by its own test file. Stubbed here to a plain input so this file can drive
// `amount` directly without also mocking @solana/spl-token/solanaConnection.
vi.mock('./UsdPresetAmountInput', async () => {
  const actual = await vi.importActual<typeof UsdPresetAmountInputModule>('./UsdPresetAmountInput');
  return {
    ...actual,
    UsdPresetAmountInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      // eslint-disable-next-line jsx-a11y/no-redundant-roles
      <input aria-label="Amount" value={value} onChange={(event) => onChange(event.target.value)} />
    ),
  };
});
// SolAmountInput (the SELL-side counterpart, see its own doc comment) does its own live
// RPC balance read — already covered by its own test file. Stubbed here the same way, so
// this file can drive `amount` directly on either side without also mocking
// @/lib/solana-config's solanaConnection.
vi.mock('./SolAmountInput', async () => {
  const actual = await vi.importActual<typeof SolAmountInputModule>('./SolAmountInput');
  return {
    ...actual,
    SolAmountInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
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
    sponsoredByRelayer: false,
    ...overrides,
  };
}

// Every Solana trade is gas-sponsored now (2026-10-04) — there is no self-paid quote path left.
async function fillAmountAndWaitForQuote() {
  await userEvent.type(screen.getByLabelText('Amount'), '10000000');
  await waitFor(() => expect(getSponsoredSolanaQuoteMock).toHaveBeenCalled(), { timeout: 3000 });
}

async function fillAmountAndWaitForSponsoredQuote() {
  await userEvent.type(screen.getByLabelText('Amount'), '10000000');
  await waitFor(() => expect(getSponsoredSolanaQuoteMock).toHaveBeenCalled(), { timeout: 3000 });
}

describe('SolanaTradePanel', () => {
  beforeEach(() => {
    resetEmbeddedWalletCreation();
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
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('backs up Privy: creates the Solana wallet itself only if none exists 10s after sign-in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [], ready: true });
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    act(() => vi.advanceTimersByTime(WALLET_CREATION_FALLBACK_DELAY_MS - 1));
    expect(createSolanaWalletMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await vi.waitFor(() => expect(createSolanaWalletMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Setting up your wallet…' })).toBeDisabled();
    vi.useRealTimers();
  });

  it('never creates a Solana wallet before sign-in, while wallets are loading, or when one exists', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [], ready: true });
    const { rerender } = render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [], ready: false });
    rerender(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    useWalletsMock.mockReturnValue({ wallets: [{ address: WALLET_ADDRESS }], ready: true });
    rerender(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    expect(createSolanaWalletMock).not.toHaveBeenCalled();
  });

  it('shows a retry, not an endless spinner, when creating the Solana wallet fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    createSolanaWalletMock.mockRejectedValueOnce(new Error('Network error'));
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [], ready: true });
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    act(() => vi.advanceTimersByTime(WALLET_CREATION_FALLBACK_DELAY_MS));

    const retry = await screen.findByRole('button', { name: 'Network error — tap to retry' });
    vi.useRealTimers();
    // A manual retry goes immediately — no second 10s wait.
    await userEvent.click(retry);
    await vi.waitFor(() => expect(createSolanaWalletMock).toHaveBeenCalledTimes(2));
  });

  it('sign-in calls Privy login()', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: loginMock });
    useWalletsMock.mockReturnValue({ wallets: [] });
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('shows setup progress, never the trade form or a "Verify wallet" button, while a connected wallet is still being verified', () => {
    useSolanaWalletVerificationMock.mockReturnValue({
      status: 'unverified',
      error: null,
      verify: verifyMock,
      isConnected: true,
      address: WALLET_ADDRESS,
    });
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    expect(screen.getByRole('status')).toHaveTextContent('Setting up your wallet for trading…');
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
  });

  it('offers a manual retry only when automatic verification failed', async () => {
    useSolanaWalletVerificationMock.mockReturnValue({
      status: 'rejected',
      error: 'User rejected the request',
      verify: verifyMock,
      isConnected: true,
      address: WALLET_ADDRESS,
    });
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(verifyMock).toHaveBeenCalled();
    expect(screen.getByText('User rejected the request')).toBeInTheDocument();
  });

  it('fetches a real quote after an amount is entered and enables Review once it resolves', async () => {
    getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote());
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    await fillAmountAndWaitForQuote();

    expect(await screen.findByRole('button', { name: 'Buy now' })).toBeEnabled();
  });

  it('never enables Review while the quote is still loading or failed', async () => {
    getSponsoredSolanaQuoteMock.mockRejectedValue(new Error('No live quote is available'));
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    await userEvent.type(screen.getByLabelText('Amount'), '10000000');
    await waitFor(() => expect(getSponsoredSolanaQuoteMock).toHaveBeenCalled(), { timeout: 3000 });

    expect(await screen.findByText('No live quote is available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeDisabled();
  });

  it('switching to SELL relabels the review/confirm actions accordingly', async () => {
    getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote({ side: 'SELL' }));
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    await userEvent.click(screen.getByRole('button', { name: /Sell SOL/i }));
    await fillAmountAndWaitForQuote();

    expect(await screen.findByRole('button', { name: 'Sell now' })).toBeEnabled();
  });

  it('clears a typed amount when switching sides, rather than reinterpreting it in the wrong unit', async () => {
    // BUY's amount is raw USDC (6 decimals); SELL's is raw SOL (9 decimals) — carrying a
    // stale value across the switch would silently misinterpret it in the new unit.
    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);

    await userEvent.type(screen.getByLabelText('Amount'), '10000000');
    expect(screen.getByLabelText('Amount')).toHaveValue('10000000');

    await userEvent.click(screen.getByRole('button', { name: /Sell SOL/i }));

    expect(screen.getByLabelText('Amount')).toHaveValue('');
  });

  it('gasless confirm & sign signs only (never sign-and-send, never Jito) and submits the partially-signed bytes to the sponsored endpoint', async () => {
    const quote = fakeQuote();
    getSponsoredSolanaQuoteMock.mockResolvedValue(quote);
    signTransaction.mockResolvedValue({ signedTransaction: new Uint8Array([9, 9, 9]) });
    submitSponsoredSolanaTransactionMock.mockResolvedValue(fakeTransaction({ sponsoredByRelayer: true }));

    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    await fillAmountAndWaitForSponsoredQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy now' }));

    await waitFor(() =>
      expect(submitSponsoredSolanaTransactionMock).toHaveBeenCalledWith({
        quoteId: quote.id,
        walletAddress: WALLET_ADDRESS,
        partiallySignedTxBase64: btoa(String.fromCharCode(9, 9, 9)), // base64 of bytes [9,9,9]
      }),
    );
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(sendRawTransactionMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Waiting for confirmation…')).toBeInTheDocument();
  });

  it('a failed sponsored submission shows the real error on the review step, never a stuck or broken state', async () => {
    const quote = fakeQuote();
    getSponsoredSolanaQuoteMock.mockResolvedValue(quote);
    signTransaction.mockResolvedValue({ signedTransaction: new Uint8Array([9, 9, 9]) });
    submitSponsoredSolanaTransactionMock.mockRejectedValue(new Error('Gas sponsorship is not enabled on this deployment'));

    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    await fillAmountAndWaitForSponsoredQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy now' }));

    expect(await screen.findByText('Gas sponsorship is not enabled on this deployment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm & buy' })).toBeInTheDocument();
  });

  it('keeps the user on the review step and shows the real error if signing is rejected', async () => {
    getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote());
    signTransaction.mockRejectedValueOnce(new Error('User rejected the request'));

    render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
    await fillAmountAndWaitForQuote();
    await userEvent.click(await screen.findByRole('button', { name: 'Buy now' }));

    expect(await screen.findByText('You cancelled this in your wallet — nothing was sent.')).toBeInTheDocument(); // friendly, never the raw wallet error
    expect(screen.getByRole('button', { name: 'Confirm & buy' })).toBeInTheDocument();
    expect(submitSponsoredSolanaTransactionMock).not.toHaveBeenCalled();
  });

  it(
    'polling picks up a CONFIRMED status and shows the confirmed view with a working Solscan link',
    async () => {
      getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote());
      signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
      submitSponsoredSolanaTransactionMock.mockResolvedValue(fakeTransaction());
      getSolanaTransactionMock.mockResolvedValue(fakeTransaction({ status: 'CONFIRMED', confirmedAt: new Date().toISOString() }));

      render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
      await fillAmountAndWaitForQuote();
      await userEvent.click(await screen.findByRole('button', { name: 'Buy now' }));
      await screen.findByText('Waiting for confirmation…');

      expect(await screen.findByText('Trade confirmed', {}, { timeout: 5000 })).toBeInTheDocument();
      const solscanLink = screen.getByRole('link', { name: /View on Solscan/i });
      expect(solscanLink.getAttribute('href')).toBe('https://solscan.io/tx/sig123');
    },
    10000,
  );

  it(
    "shows a real, decimal-scaled SOL amount in the confirmed toast for a BUY, never the bare raw lamport integer",
    async () => {
      getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote());
      signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
      submitSponsoredSolanaTransactionMock.mockResolvedValue(fakeTransaction());
      // expectedOutputAmount '98600000' raw lamports (BUY's output is always SOL, 9
      // decimals) must render as '0.0986 SOL', not the bare raw integer — see
      // formatReceivedAmount's own doc comment for why this toast can't reuse
      // SolanaQuoteSummary's "N raw units" label.
      getSolanaTransactionMock.mockResolvedValue(fakeTransaction({ status: 'CONFIRMED', confirmedAt: new Date().toISOString() }));

      render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
      await fillAmountAndWaitForQuote();
      await userEvent.click(await screen.findByRole('button', { name: 'Buy now' }));
      await screen.findByText('Waiting for confirmation…');
      await screen.findByText('Trade confirmed', {}, { timeout: 5000 });

      expect(updateMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: 'Trade confirmed', description: '0.0986 SOL' }),
      );
    },
    10000,
  );

  it(
    'shows a real, decimal-scaled USDC amount in the confirmed toast for a SELL, never the bare raw micro-unit integer',
    async () => {
      getSponsoredSolanaQuoteMock.mockResolvedValue(fakeQuote({ side: 'SELL' }));
      signAndSendTransaction.mockResolvedValue({ signature: new Uint8Array([1, 2, 3, 4]) });
      // '5000000' raw USDC micro-units (6 decimals) — SELL's output is always USDC — must
      // render as '$5 USDC' (same maximumFractionDigits:2, no forced trailing zeros
      // convention as SolanaQuoteSummary's own usdcDisplay), not the bare raw integer.
      submitSponsoredSolanaTransactionMock.mockResolvedValue(fakeTransaction({ side: 'SELL', expectedOutputAmount: '5000000' }));
      getSolanaTransactionMock.mockResolvedValue(
        fakeTransaction({ side: 'SELL', expectedOutputAmount: '5000000', status: 'CONFIRMED', confirmedAt: new Date().toISOString() }),
      );

      render(<SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />);
      await userEvent.click(await screen.findByRole('button', { name: 'Sell SOL' }));
      await fillAmountAndWaitForQuote();
      await userEvent.click(await screen.findByRole('button', { name: 'Sell now' }));
      await screen.findByText('Waiting for confirmation…');
      await screen.findByText('Trade confirmed', {}, { timeout: 5000 });

      expect(updateMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: 'Trade confirmed', description: '$5 USDC' }),
      );
    },
    10000,
  );
});
