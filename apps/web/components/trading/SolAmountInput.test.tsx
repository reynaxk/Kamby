import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SolAmountInput, solToRawLamports } from './SolAmountInput';

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));
vi.mock('@/lib/solana-config', () => ({ solanaConnection: { getBalance } }));

// A real, previously-confirmed-valid mainnet address — `new PublicKey(walletAddress)`
// inside the component is not mocked, so this has to actually decode as a valid base58
// Solana pubkey.
const WALLET = '8nTncbaJ8gc8ooDWRFt9TKjog7743iHC43iEcesAbAee';

describe('SolAmountInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBalance.mockResolvedValue(0);
  });

  it('a preset click applies the exact raw lamport amount, not a rounded/approximate one', async () => {
    const onChange = vi.fn();
    render(<SolAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await userEvent.click(screen.getByRole('button', { name: '0.05' }));
    expect(onChange).toHaveBeenCalledWith('50000000');
  });

  it('typing a SOL amount converts it to raw lamports, never raw USDC units', async () => {
    const onChange = vi.fn();
    render(<SolAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await userEvent.type(screen.getByPlaceholderText('0'), '1');
    expect(onChange).toHaveBeenLastCalledWith('1000000000');
  });

  it('shows the live SOL balance once loaded, formatted in SOL, not USDC', async () => {
    getBalance.mockResolvedValue(5_500_000_000);
    render(<SolAmountInput value="" onChange={vi.fn()} walletAddress={WALLET} />);
    expect(await screen.findByText('5.5 SOL')).toBeInTheDocument();
  });

  it('never fabricates a balance when the RPC read fails', async () => {
    getBalance.mockRejectedValue(new Error('RPC unreachable'));
    render(<SolAmountInput value="" onChange={vi.fn()} walletAddress={WALLET} />);
    await vi.waitFor(() => expect(getBalance).toHaveBeenCalled());
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
  });

  it('Max reserves fee headroom rather than spending the entire live balance', async () => {
    getBalance.mockResolvedValue(1_000_000_000); // 1 SOL
    const onChange = vi.fn();
    render(<SolAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await screen.findByText('1 SOL');
    await userEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(onChange).toHaveBeenCalledWith('990000000'); // 1 SOL minus the 0.01 SOL reserve
  });

  it('Max never goes negative for a balance smaller than the fee reserve', async () => {
    getBalance.mockResolvedValue(1_000_000); // 0.001 SOL — below the 0.01 SOL reserve
    const onChange = vi.fn();
    render(<SolAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await screen.findByText('0.001 SOL');
    await userEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(onChange).toHaveBeenCalledWith('0');
  });

  it('highlights the preset matching the current raw value', async () => {
    render(<SolAmountInput value={solToRawLamports(0.1)} onChange={vi.fn()} walletAddress={WALLET} />);
    expect(screen.getByRole('button', { name: '0.1' })).toHaveClass('text-accent');
    expect(screen.getByRole('button', { name: '0.05' })).not.toHaveClass('text-accent');
  });
});
