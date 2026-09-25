import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WagmiModule from 'wagmi';
import { FundModal } from './FundModal';

const { usePrivyMock, useAddFundsMock, addFundsMock, useSolanaWalletsMock, useAccountMock, fetchEvmChainConfigsMock } = vi.hoisted(() => ({
  usePrivyMock: vi.fn(),
  useAddFundsMock: vi.fn(),
  addFundsMock: vi.fn(),
  useSolanaWalletsMock: vi.fn(),
  useAccountMock: vi.fn(),
  fetchEvmChainConfigsMock: vi.fn(),
}));

vi.mock('@privy-io/react-auth', () => ({ usePrivy: usePrivyMock, useAddFunds: useAddFundsMock }));
vi.mock('@privy-io/react-auth/solana', () => ({ useWallets: useSolanaWalletsMock }));
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof WagmiModule>();
  return { ...actual, useAccount: useAccountMock };
});
vi.mock('@/lib/market-client', () => ({ fetchEvmChainConfigs: fetchEvmChainConfigsMock }));
vi.mock('@/components/wallet/ConnectWalletButton', () => ({
  ConnectWalletButton: ({ expectedChainId }: { expectedChainId?: number }) => (
    <div data-testid="connect-wallet-button">Connect (chain {expectedChainId})</div>
  ),
}));

const EVM_ADDRESS = '0x1234567890AbcdEF1234567890aBcdef12345678';
const SOLANA_ADDRESS = '11111111111111111111111111111112';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function setConnectedEvm() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: EVM_ADDRESS, chainId: 8453 });
  useSolanaWalletsMock.mockReturnValue({ wallets: [] });
}

function setConnectedSolana() {
  usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
  useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
  useSolanaWalletsMock.mockReturnValue({ wallets: [{ address: SOLANA_ADDRESS }] });
}

beforeEach(() => {
  useAddFundsMock.mockReturnValue({ addFunds: addFundsMock });
  fetchEvmChainConfigsMock.mockResolvedValue([{ slug: 'base', chainId: 8453, usdcAddress: BASE_USDC }]);
});

describe('FundModal', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when closed', () => {
    setConnectedEvm();
    const { container } = render(<FundModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows ConnectWalletButton when no EVM wallet is connected on the default (Base) chain', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: vi.fn() });
    useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
    useSolanaWalletsMock.mockReturnValue({ wallets: [] });

    render(<FundModal open onClose={vi.fn()} />);

    expect(await screen.findByTestId('connect-wallet-button')).toHaveTextContent('chain 8453');
  });

  it('shows a Solana "Sign in" button once Solana is selected with no wallet', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login: vi.fn() });
    useAccountMock.mockReturnValue({ address: undefined, chainId: undefined });
    useSolanaWalletsMock.mockReturnValue({ wallets: [] });
    const user = userEvent.setup();

    render(<FundModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Solana' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('calls addFunds with the real connected EVM address, the real Base CAIP-2 identifier, and the real USDC address — never a placeholder', async () => {
    setConnectedEvm();
    addFundsMock.mockResolvedValue({ method: 'fiat', status: 'submitted' });
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<FundModal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(addFundsMock).toHaveBeenCalledWith({
        destination: { address: EVM_ADDRESS, chain: 'eip155:8453', asset: BASE_USDC },
        fiat: {},
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("calls addFunds with the real connected Solana address and Privy's own solana:mainnet chain key", async () => {
    setConnectedSolana();
    addFundsMock.mockResolvedValue({ method: 'fiat', status: 'submitted' });
    const user = userEvent.setup();

    render(<FundModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Solana' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(addFundsMock).toHaveBeenCalledWith({
        destination: { address: SOLANA_ADDRESS, chain: 'solana:mainnet', asset: expect.any(String) },
        fiat: {},
      }),
    );
  });

  it('shows the real error message and a Try again action when starting the funding flow fails, never a fake success', async () => {
    setConnectedEvm();
    addFundsMock.mockRejectedValue(new Error('Funding is not enabled for this account.'));
    const user = userEvent.setup();

    render(<FundModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Funding is not enabled for this account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('disables Continue when connected but this chain has no real, resolved USDC address', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn() });
    useAccountMock.mockReturnValue({ address: EVM_ADDRESS, chainId: 56 }); // connected on BNB
    useSolanaWalletsMock.mockReturnValue({ wallets: [] });
    fetchEvmChainConfigsMock.mockResolvedValue([]); // no USDC config for any chain
    const user = userEvent.setup();

    render(<FundModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'BNB Chain' }));

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
