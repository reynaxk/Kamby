import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsdPresetAmountInput, usdToRawUsdc } from './UsdPresetAmountInput';

const { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } = vi.hoisted(() => {
  class TokenAccountNotFoundError extends Error {}
  return {
    getAssociatedTokenAddress: vi.fn(),
    getAccount: vi.fn(),
    TokenAccountNotFoundError,
  };
});
vi.mock('@solana/spl-token', () => ({ getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError }));
vi.mock('@/lib/solana-config', () => ({ solanaConnection: {} }));

// A real, previously-confirmed-valid mainnet address — @solana/spl-token's `getAccount`
// is mocked, but `new PublicKey(walletAddress)` inside the component is not, so this has to
// actually decode as a valid base58 Solana pubkey.
const WALLET = '8nTncbaJ8gc8ooDWRFt9TKjog7743iHC43iEcesAbAee';

describe('UsdPresetAmountInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssociatedTokenAddress.mockResolvedValue('mock-ata');
    getAccount.mockResolvedValue({ amount: 0n });
  });

  it('a $ preset click applies the exact raw USDC amount, not a rounded/approximate one', async () => {
    const onChange = vi.fn();
    render(<UsdPresetAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await userEvent.click(screen.getByRole('button', { name: '$25' }));
    expect(onChange).toHaveBeenCalledWith('25000000');
  });

  it('typing a dollar amount converts it to raw USDC units', async () => {
    const onChange = vi.fn();
    render(<UsdPresetAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await userEvent.type(screen.getByPlaceholderText('0'), '5');
    expect(onChange).toHaveBeenLastCalledWith('5000000');
  });

  it('shows the live USDC balance once loaded, formatted as dollars', async () => {
    getAccount.mockResolvedValue({ amount: 5_500_000n });
    render(<UsdPresetAmountInput value="" onChange={vi.fn()} walletAddress={WALLET} />);
    expect(await screen.findByText('$5.5')).toBeInTheDocument();
  });

  it('shows a real, honest zero balance for a wallet that has never held USDC — not an unknown state', async () => {
    getAccount.mockRejectedValue(new TokenAccountNotFoundError('no ATA'));
    render(<UsdPresetAmountInput value="" onChange={vi.fn()} walletAddress={WALLET} />);
    expect(await screen.findByText('$0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
  });

  it('never fabricates a balance when the RPC read fails for a reason other than a missing ATA', async () => {
    getAccount.mockRejectedValue(new Error('RPC unreachable'));
    render(<UsdPresetAmountInput value="" onChange={vi.fn()} walletAddress={WALLET} />);
    await vi.waitFor(() => expect(getAccount).toHaveBeenCalled());
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
  });

  it('Max applies the full live balance, in raw units', async () => {
    getAccount.mockResolvedValue({ amount: 12_340_000n });
    const onChange = vi.fn();
    render(<UsdPresetAmountInput value="" onChange={onChange} walletAddress={WALLET} />);
    await screen.findByText('$12.34');
    await userEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(onChange).toHaveBeenCalledWith('12340000');
  });

  it('highlights the preset matching the current raw value', async () => {
    render(<UsdPresetAmountInput value={usdToRawUsdc(50)} onChange={vi.fn()} walletAddress={WALLET} />);
    expect(screen.getByRole('button', { name: '$50' })).toHaveClass('text-accent');
    expect(screen.getByRole('button', { name: '$25' })).not.toHaveClass('text-accent');
  });
});
