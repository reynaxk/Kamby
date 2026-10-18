import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WagmiModule from 'wagmi';
import type * as SendModule from '@/lib/send';
import { SendModal } from './SendModal';

const {
  usePrivyMock,
  useSolanaWalletsMock,
  signAndSendTransactionMock,
  useAccountMock,
  useBalanceMock,
  fetchEvmChainConfigsMock,
  sendEvmNativeMock,
  sendEvmTokenMock,
  buildSolanaNativeTransferTxMock,
  buildSolanaTokenTransferTxMock,
  readEvmTokenDecimalsMock,
  estimateNativeSendReserveMock,
} = vi.hoisted(() => ({
  usePrivyMock: vi.fn(),
  useSolanaWalletsMock: vi.fn(),
  signAndSendTransactionMock: vi.fn(),
  useAccountMock: vi.fn(),
  useBalanceMock: vi.fn(),
  fetchEvmChainConfigsMock: vi.fn(),
  sendEvmNativeMock: vi.fn(),
  sendEvmTokenMock: vi.fn(),
  buildSolanaNativeTransferTxMock: vi.fn(),
  buildSolanaTokenTransferTxMock: vi.fn(),
  readEvmTokenDecimalsMock: vi.fn(),
  estimateNativeSendReserveMock: vi.fn(),
}));

vi.mock('@privy-io/react-auth', () => ({ usePrivy: usePrivyMock }));
vi.mock('@privy-io/react-auth/solana', () => ({
  useWallets: useSolanaWalletsMock,
  useSignAndSendTransaction: () => ({ signAndSendTransaction: signAndSendTransactionMock }),
}));
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof WagmiModule>();
  return { ...actual, useAccount: useAccountMock, useBalance: useBalanceMock };
});
vi.mock('@/lib/market-client', () => ({ fetchEvmChainConfigs: fetchEvmChainConfigsMock }));
const { getBalanceMock } = vi.hoisted(() => ({ getBalanceMock: vi.fn() }));
vi.mock('@/lib/solana-config', () => ({ solanaConnection: { getLatestBlockhash: vi.fn(), getBalance: getBalanceMock } }));
vi.mock('@/components/wallet/ConnectWalletButton', () => ({
  ConnectWalletButton: ({ expectedChainId }: { expectedChainId?: number }) => (
    <div data-testid="connect-wallet-button">Connect (chain {expectedChainId})</div>
  ),
}));
vi.mock('@/lib/send', async (importOriginal) => {
  const actual = await importOriginal<typeof SendModule>();
  return {
    ...actual,
    sendEvmNative: sendEvmNativeMock,
    sendEvmToken: sendEvmTokenMock,
    buildSolanaNativeTransferTx: buildSolanaNativeTransferTxMock,
    buildSolanaTokenTransferTx: buildSolanaTokenTransferTxMock,
    readEvmTokenDecimals: readEvmTokenDecimalsMock,
    estimateNativeSendReserve: estimateNativeSendReserveMock,
  };
});

vi.mock('@/lib/use-cross-chain-funding', () => ({
  // No cross-chain move in these tests — the network's own balance decides, as before.
  useCrossChainFunding: () => ({ balances: { base: null, bnb: null, robinhood: null, solana: null, total: null }, moveUsd: 0, source: null, canCover: false, stage: 'idle', error: null, feeUsd: null, move: async () => {} }),
}));

const EVM_ADDRESS = '0x1234567890AbcdEF1234567890aBcdef12345678';
const SOLANA_ADDRESS = '11111111111111111111111111111112';

function setConnectedEvm() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: EVM_ADDRESS, chainId: 8453 });
  useSolanaWalletsMock.mockReturnValue({ wallets: [] });
  useBalanceMock.mockReturnValue({ data: { value: 25_000_000n } }); // 25 USDC (6 decimals)
}

function setConnectedSolana() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
  useSolanaWalletsMock.mockReturnValue({ wallets: [{ address: SOLANA_ADDRESS }] });
  useBalanceMock.mockReturnValue({ data: undefined });
  getBalanceMock.mockResolvedValue(1_000_000_000); // 1 SOL — plenty for fees, the sane default
}

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('SendModal', () => {
  beforeEach(() => readEvmTokenDecimalsMock.mockResolvedValue(6));
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const { container } = render(<SendModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows ConnectWalletButton (not a Sign-in button) when no EVM wallet is connected on the default (Base) chain', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: vi.fn() });
    useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
    useSolanaWalletsMock.mockReturnValue({ wallets: [] });
    useBalanceMock.mockReturnValue({ data: undefined });
    fetchEvmChainConfigsMock.mockResolvedValue([]);

    render(<SendModal open onClose={vi.fn()} />);

    expect(await screen.findByTestId('connect-wallet-button')).toHaveTextContent('chain 8453');
  });

  it('shows a Solana "Sign in" button (not ConnectWalletButton) once Solana is selected with no wallet', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: vi.fn() });
    useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
    useSolanaWalletsMock.mockReturnValue({ wallets: [] });
    useBalanceMock.mockReturnValue({ data: undefined });
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('connect-wallet-button')).not.toBeInTheDocument();
  });

  it('withdraws USDC only — no ETH/BNB/SOL to pick (that is Kamby gas, 2026-10-13)', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/Amount \(USDC\)/)).toBeInTheDocument();
    for (const native of ['ETH', 'BNB', 'SOL']) expect(screen.queryByRole('button', { name: native })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Solana' }));
    for (const native of ['ETH', 'BNB', 'SOL']) expect(screen.queryByRole('button', { name: native })).not.toBeInTheDocument();
  });

  it('shows a live validation error for a malformed destination address, and clears it once fixed', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    const destinationInput = await screen.findByPlaceholderText('0x…');
    await user.type(destinationInput, 'not-an-address');

    expect(screen.getByText(/doesn.t look like a valid Base address/i)).toBeInTheDocument();

    await user.clear(destinationInput);
    await user.type(destinationInput, EVM_ADDRESS);
    expect(screen.queryByText(/doesn.t look like a valid Base address/i)).not.toBeInTheDocument();
  });

  it('disables Review until amount, destination, and (for a token) resolved decimals are all valid', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await screen.findByText('Balance: 25');
    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    expect(reviewButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('0.0'), '12');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);

    expect(reviewButton).toBeEnabled();
  });

  it('rejects an amount greater than the real, live-read balance', async () => {
    setConnectedEvm(); // balance mocked to 25 USDC
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('0.0'), '999');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);

    expect(screen.getByText(/exceeds your balance/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });

  it('"Max" fills the whole USDC balance — the network fee is Kamby’s gas, not the user’s USDC', async () => {
    setConnectedEvm(); // 25 USDC
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await waitFor(() => expect(readEvmTokenDecimalsMock).toHaveBeenCalled());
    await user.click(await screen.findByRole('button', { name: 'Max' }));

    const amountInput = screen.getByPlaceholderText('0.0') as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('25'));
    expect(estimateNativeSendReserveMock).not.toHaveBeenCalled();
  });

  it('completes a full USDC withdrawal: form → review → confirm → real explorer link for the actual chain', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    sendEvmTokenMock.mockResolvedValue('0xdeadbeef');
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await screen.findByText('Balance: 25');
    await user.type(screen.getByPlaceholderText('0.0'), '12');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);
    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText(EVM_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/\$12\.00 USDC/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm.*send/i }));

    await waitFor(() => expect(sendEvmTokenMock).toHaveBeenCalledWith(BASE_USDC, EVM_ADDRESS, 12_000_000n, 8453));
    expect(sendEvmNativeMock).not.toHaveBeenCalled();
    const link = await screen.findByRole('link', { name: /basescan/i });
    expect(link).toHaveAttribute('href', 'https://basescan.org/tx/0xdeadbeef');
  });

  it('shows the real error message and a Try again action when the send itself fails, never a fake success', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    sendEvmTokenMock.mockRejectedValue(new Error('User rejected the request.'));
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await screen.findByText('Balance: 25');
    await user.type(screen.getByPlaceholderText('0.0'), '12');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: /confirm.*send/i }));

    expect(await screen.findByText('You cancelled this in your wallet — nothing was sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /basescan/i })).not.toBeInTheDocument();
  });

  it('shows no SOL-fee warning for a USDC withdrawal, even at zero SOL — Kamby covers that fee', async () => {
    setConnectedSolana();
    getBalanceMock.mockResolvedValue(0);
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    await waitFor(() => expect(getBalanceMock).toHaveBeenCalled());
    expect(screen.queryByText(/no SOL to pay the network fee/i)).not.toBeInTheDocument();
  });

  it('shows no fee warning once the wallet has enough SOL', async () => {
    setConnectedSolana(); // defaults to 1 SOL, well above the threshold
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    await waitFor(() => expect(getBalanceMock).toHaveBeenCalled());
    expect(screen.queryByText(/no SOL to pay the network fee/i)).not.toBeInTheDocument();
  });

});
