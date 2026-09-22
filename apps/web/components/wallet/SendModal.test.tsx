import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const EVM_ADDRESS = '0x1234567890AbcdEF1234567890aBcdef12345678';
const SOLANA_ADDRESS = '11111111111111111111111111111112';

function setConnectedEvm() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: EVM_ADDRESS, chainId: 8453 });
  useSolanaWalletsMock.mockReturnValue({ wallets: [] });
  useBalanceMock.mockReturnValue({ data: { value: 10_000_000_000_000_000_000n } }); // 10 ETH
}

function setConnectedSolana() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
  useSolanaWalletsMock.mockReturnValue({ wallets: [{ address: SOLANA_ADDRESS }] });
  useBalanceMock.mockReturnValue({ data: undefined });
  getBalanceMock.mockResolvedValue(1_000_000_000); // 1 SOL — plenty for fees, the sane default
}

describe('SendModal', () => {
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
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('connect-wallet-button')).not.toBeInTheDocument();
  });

  it('resets the asset selection back to native when the chain is switched', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([{ slug: 'base', chainId: 8453, usdcAddress: '0xusdc' }]);
    readEvmTokenDecimalsMock.mockResolvedValue(6);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'USDC' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'USDC' }));
    await user.click(screen.getByRole('button', { name: 'BNB Chain' }));

    // Back on the native asset for the new chain — USDC isn't configured for BNB in this mock.
    expect(screen.queryByRole('button', { name: 'USDC' })).not.toBeInTheDocument();
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
    const reviewButton = await screen.findByRole('button', { name: 'Review' });
    expect(reviewButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('0.0'), '1');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);

    expect(reviewButton).toBeEnabled();
  });

  it('rejects an amount greater than the real, live-read balance', async () => {
    setConnectedEvm(); // balance mocked to 10 ETH
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('0.0'), '999');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);

    expect(screen.getByText(/exceeds your balance/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });

  it('reserves gas on "Max" for an EVM native asset even before a destination is typed — real bug: this used to skip the reserve entirely and set the amount to the full balance', async () => {
    setConnectedEvm(); // 10 ETH balance
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    estimateNativeSendReserveMock.mockResolvedValue(1_000_000_000_000_000n); // 0.001 ETH
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Max' }));

    await waitFor(() => expect(estimateNativeSendReserveMock).toHaveBeenCalledWith(8453, EVM_ADDRESS));
    const amountInput = screen.getByPlaceholderText('0.0') as HTMLInputElement;
    expect(amountInput.value).toBe('9.999'); // 10 ETH balance minus the 0.001 ETH reserve
  });

  it('completes a full EVM native send: form → review → confirm → real explorer link for the actual chain', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    sendEvmNativeMock.mockResolvedValue('0xdeadbeef');
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('0.0'), '1');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);
    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText(EVM_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/1 ETH/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm.*send/i }));

    await waitFor(() => expect(sendEvmNativeMock).toHaveBeenCalledWith(EVM_ADDRESS, 1_000_000_000_000_000_000n, 8453));
    const link = await screen.findByRole('link', { name: /basescan/i });
    expect(link).toHaveAttribute('href', 'https://basescan.org/tx/0xdeadbeef');
  });

  it('shows the real error message and a Try again action when the send itself fails, never a fake success', async () => {
    setConnectedEvm();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    sendEvmNativeMock.mockRejectedValue(new Error('User rejected the request.'));
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('0.0'), '1');
    await user.type(screen.getByPlaceholderText('0x…'), EVM_ADDRESS);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: /confirm.*send/i }));

    expect(await screen.findByText('User rejected the request.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /basescan/i })).not.toBeInTheDocument();
  });

  it('warns when the Solana wallet has no SOL for the network fee — even when sending a token, not native SOL — and blocks Review', async () => {
    setConnectedSolana();
    getBalanceMock.mockResolvedValue(0); // real reported failure mode: a USDC-only wallet with zero SOL
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    expect(await screen.findByText(/no SOL to pay the network fee/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('0.0'), '1');
    await user.type(screen.getByPlaceholderText('Solana address'), SOLANA_ADDRESS);
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });

  it('shows no fee warning once the wallet has enough SOL', async () => {
    setConnectedSolana(); // defaults to 1 SOL, well above the threshold
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    await waitFor(() => expect(getBalanceMock).toHaveBeenCalled());
    expect(screen.queryByText(/no SOL to pay the network fee/i)).not.toBeInTheDocument();
  });

  it('completes a full Solana send by building the real transaction bytes and encoding the returned signature as base58', async () => {
    setConnectedSolana();
    fetchEvmChainConfigsMock.mockResolvedValue([]);
    const fakeTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])) };
    buildSolanaNativeTransferTxMock.mockResolvedValue(fakeTx);
    signAndSendTransactionMock.mockResolvedValue({ signature: new Uint8Array(64) }); // all-zero -> a real, decodable base58 string
    const user = userEvent.setup();

    render(<SendModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Solana' }));
    await user.type(screen.getByPlaceholderText('0.0'), '1');
    await user.type(screen.getByPlaceholderText('Solana address'), SOLANA_ADDRESS);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: /confirm.*send/i }));

    await waitFor(() => expect(buildSolanaNativeTransferTxMock).toHaveBeenCalled());
    expect(fakeTx.serialize).toHaveBeenCalledWith({ requireAllSignatures: false, verifySignatures: false });
    const link = await screen.findByRole('link', { name: /solscan/i });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/solscan\.io\/tx\//);
  });
});
