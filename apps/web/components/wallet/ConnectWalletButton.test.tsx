import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectWalletButton } from './ConnectWalletButton';

const { usePrivyMock, useWalletsMock, useCreateWalletMock, createWalletMock, useAccount, useSwitchChain } = vi.hoisted(() => ({
  usePrivyMock: vi.fn(),
  useWalletsMock: vi.fn(),
  useCreateWalletMock: vi.fn(),
  createWalletMock: vi.fn(),
  useAccount: vi.fn(),
  useSwitchChain: vi.fn(),
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: usePrivyMock,
  useWallets: useWalletsMock,
  useCreateWallet: useCreateWalletMock,
}));
vi.mock('wagmi', () => ({ useAccount, useSwitchChain }));
vi.mock('wagmi/chains', () => ({ base: { id: 8453 } }));

afterEach(() => vi.clearAllMocks());

const ADDRESS = '0x1234567890123456789012345678901234567890';

// Default: authenticated with an existing wallet already synced, so the auto-create effect
// (see ConnectWalletButton.tsx's 2026-09-15 useCreateWallet workaround) is a no-op unless a
// specific test overrides it to exercise that path.
function mockConnectedDefaults() {
  useWalletsMock.mockReturnValue({ wallets: [{ address: ADDRESS }], ready: true });
  createWalletMock.mockResolvedValue({ address: ADDRESS });
  useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
  useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });
}

describe('ConnectWalletButton', () => {
  it('shows "Sign in" and triggers the Privy login modal when signed out', async () => {
    const login = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: false, login, logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    await userEvent.click(button);

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state before Privy is ready, without calling login', () => {
    usePrivyMock.mockReturnValue({ ready: false, authenticated: false, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('shows "Setting up your wallet…" once Privy has authenticated but wagmi has not yet synced the wallet', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: 'Setting up your wallet…' })).toBeDisabled();
  });

  it('explicitly creates an Ethereum embedded wallet when authenticated with zero wallets — the create_on_login "off" workaround', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useWalletsMock.mockReturnValue({ wallets: [], ready: true });
    createWalletMock.mockResolvedValue({ address: ADDRESS });
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);

    await waitFor(() => expect(createWalletMock).toHaveBeenCalledTimes(1));
  });

  it('never calls createWallet while wallets are still loading or a wallet already exists', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useWalletsMock.mockReturnValue({ wallets: [], ready: false });
    createWalletMock.mockResolvedValue({ address: ADDRESS });
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);

    expect(createWalletMock).not.toHaveBeenCalled();
  });

  it('shows a real error with a retry affordance when createWallet fails, rather than hanging forever', async () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useWalletsMock.mockReturnValue({ wallets: [], ready: true });
    createWalletMock.mockRejectedValue(new Error('Wallet creation failed'));
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain: vi.fn(), isPending: false });

    render(<ConnectWalletButton />);

    expect(await screen.findByText(/Wallet creation failed/)).toBeInTheDocument();
  });

  it('shows a "Wrong network" prompt rather than the address when connected off Base', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 1 });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: /wrong network/i })).toBeInTheDocument();
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();
  });

  it('automatically attempts switchChain to Base the moment a wrong network is detected, with no click required', async () => {
    const switchChain = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 1 });
    useWalletsMock.mockReturnValue({ wallets: [{ address: ADDRESS }], ready: true });
    createWalletMock.mockResolvedValue({ address: ADDRESS });
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain, isPending: false });

    render(<ConnectWalletButton />);

    await waitFor(() => expect(switchChain).toHaveBeenCalledWith({ chainId: 8453 }));
    expect(switchChain).toHaveBeenCalledTimes(1);
  });

  it('respects a real expectedChainId prop — BNB Chain going live, 2026-09-16', async () => {
    const switchChain = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    mockConnectedDefaults();
    useSwitchChain.mockReturnValue({ switchChain, isPending: false });

    render(<ConnectWalletButton expectedChainId={56} />);

    expect(screen.getByRole('button', { name: /wrong network.*bnb chain/i })).toBeInTheDocument();
    await waitFor(() => expect(switchChain).toHaveBeenCalledWith({ chainId: 56 }));
  });

  it('never attempts switchChain while disconnected — only once a wallet is actually on the wrong chain', () => {
    const switchChain = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useWalletsMock.mockReturnValue({ wallets: [{ address: ADDRESS }], ready: true });
    createWalletMock.mockResolvedValue({ address: ADDRESS });
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain, isPending: false });

    render(<ConnectWalletButton />);

    expect(switchChain).not.toHaveBeenCalled();
  });

  it('shows the real switchChain error and still allows a manual retry click, rather than silently looping', async () => {
    const switchChain = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 1 });
    useWalletsMock.mockReturnValue({ wallets: [{ address: ADDRESS }], ready: true });
    createWalletMock.mockResolvedValue({ address: ADDRESS });
    useCreateWalletMock.mockReturnValue({ createWallet: createWalletMock });
    useSwitchChain.mockReturnValue({ switchChain, isPending: false, error: new Error('User rejected the request') });

    render(<ConnectWalletButton />);

    expect(await screen.findByText('User rejected the request')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /wrong network/i }));
    expect(switchChain).toHaveBeenCalledWith({ chainId: 8453 });
  });

  it('shows the truncated address once connected to the right network', () => {
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout: vi.fn() });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);

    expect(screen.getByRole('button', { name: '0x1234…7890' })).toBeInTheDocument();
  });

  it('opens a menu with the full address, rather than signing out, when the connected button is clicked', async () => {
    const logout = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: '0x1234…7890' }));

    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('copies the full address to the clipboard and shows confirmation, rather than signing out', async () => {
    // userEvent.setup() installs its own navigator.clipboard stub — stubbing clipboard
    // before setup() gets silently overwritten by it, so this must stub clipboard after.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const logout = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);
    await user.click(screen.getByRole('button', { name: '0x1234…7890' }));
    await user.click(screen.getByText(ADDRESS));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('signs out via Privy logout only when "Sign out" is explicitly clicked', async () => {
    const logout = vi.fn();
    usePrivyMock.mockReturnValue({ ready: true, authenticated: true, login: vi.fn(), logout });
    useAccount.mockReturnValue({ address: ADDRESS, isConnected: true, chainId: 8453 });
    mockConnectedDefaults();

    render(<ConnectWalletButton />);
    await userEvent.click(screen.getByRole('button', { name: '0x1234…7890' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
