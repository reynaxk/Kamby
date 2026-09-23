import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AmountInput } from './AmountInput';

// AmountInput's `value` is a controlled prop — userEvent.type against a fixed, never-updated
// value would reset the DOM input back to that value after every keystroke, so only the
// final character would ever "stick" (a real trap; the first version of this test file hit
// it typing '1.5' and got '5' back). This wrapper makes the input genuinely controlled, the
// same as every real call site, so typing tests actually exercise cumulative input.
function ControlledAmountInput(props: Omit<Parameters<typeof AmountInput>[0], 'value' | 'onChange'>) {
  const [value, setValue] = useState('');
  return <AmountInput {...props} value={value} onChange={setValue} />;
}

const { useAccountMock, useBalanceMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  useBalanceMock: vi.fn(),
}));
vi.mock('wagmi', () => ({ useAccount: useAccountMock, useBalance: useBalanceMock }));

const WALLET = '0x1234567890123456789012345678901234567890';
const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const defaultProps = {
  value: '',
  onChange: vi.fn(),
  inputTokenAddress: TOKEN,
  inputTokenSymbol: 'FOO',
  inputTokenDecimals: 18,
};

describe('AmountInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountMock.mockReturnValue({ address: WALLET });
  });

  it('applies the exact fraction of the real live balance on a preset click, not a rounded/approximate one', async () => {
    // 12.3456 tokens at 18 decimals — an amount that would reveal rounding errors if the
    // fraction math used floating point instead of BigInt.
    useBalanceMock.mockReturnValue({ data: { value: 12345600000000000000n } });
    const onChange = vi.fn();
    render(<AmountInput {...defaultProps} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '25%' }));
    expect(onChange).toHaveBeenCalledWith('3.0864');
  });

  it('Max applies the entire live balance, not a fraction of it', async () => {
    useBalanceMock.mockReturnValue({ data: { value: 5000000000000000000n } });
    const onChange = vi.fn();
    render(<AmountInput {...defaultProps} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('shows the live balance once loaded, formatted in the input token, not raw units', () => {
    useBalanceMock.mockReturnValue({ data: { value: 1500000000000000000n } });
    render(<AmountInput {...defaultProps} />);
    expect(screen.getByText('Balance: 1.5')).toBeInTheDocument();
  });

  it('shows no balance and disables every preset while the balance is still loading', () => {
    useBalanceMock.mockReturnValue({ data: undefined });
    render(<AmountInput {...defaultProps} />);

    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '25%' })).toBeDisabled();
  });

  it('disables every preset for a real zero balance, distinct from still-loading', () => {
    useBalanceMock.mockReturnValue({ data: { value: 0n } });
    render(<AmountInput {...defaultProps} />);

    // A zero balance is still a resolved balance, so it does render — just with nothing
    // spendable, unlike the loading case above which shows no balance line at all.
    expect(screen.getByText('Balance: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max' })).toBeDisabled();
  });

  it('rejects a non-numeric typed value rather than passing it through', async () => {
    useBalanceMock.mockReturnValue({ data: undefined });
    render(<ControlledAmountInput {...defaultProps} />);

    const input = screen.getByPlaceholderText('0.0');
    await userEvent.type(input, 'abc');
    expect(input).toHaveValue('');
  });

  it('accepts a real multi-character decimal amount typed by hand', async () => {
    useBalanceMock.mockReturnValue({ data: undefined });
    render(<ControlledAmountInput {...defaultProps} />);

    const input = screen.getByPlaceholderText('0.0');
    await userEvent.type(input, '1.5');
    expect(input).toHaveValue('1.5');
  });
});
