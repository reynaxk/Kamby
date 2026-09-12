import { decodeFunctionData } from 'viem';
import { buildErc20TransferTx } from './erc20-transfer';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FEE_RECIPIENT = '0x001111111111111111111111111111111111AaAa';

const erc20TransferAbi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

describe('buildErc20TransferTx', () => {
  it('targets the token contract, not the recipient', () => {
    const tx = buildErc20TransferTx(USDC_ADDRESS, FEE_RECIPIENT, 1_000_000n);
    expect(tx.to).toBe(USDC_ADDRESS);
  });

  it('sends no native value — this is a pure ERC20 call', () => {
    const tx = buildErc20TransferTx(USDC_ADDRESS, FEE_RECIPIENT, 1_000_000n);
    expect(tx.value).toBe('0');
  });

  it('leaves gas fields for the wallet to estimate, matching the router convention', () => {
    const tx = buildErc20TransferTx(USDC_ADDRESS, FEE_RECIPIENT, 1_000_000n);
    expect(tx.gas).toBeNull();
    expect(tx.maxFeePerGas).toBeNull();
    expect(tx.maxPriorityFeePerGas).toBeNull();
  });

  it('encodes calldata that decodes back to the exact recipient and amount requested', () => {
    const amountRaw = 123_456_789n;
    const tx = buildErc20TransferTx(USDC_ADDRESS, FEE_RECIPIENT, amountRaw);

    const decoded = decodeFunctionData({ abi: erc20TransferAbi, data: tx.data as `0x${string}` });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args[0].toLowerCase()).toBe(FEE_RECIPIENT.toLowerCase());
    expect(decoded.args[1]).toBe(amountRaw);
  });

  it('never fabricates an amount — passes the exact bigint through with no rounding', () => {
    const oddAmount = 1n; // smallest possible raw unit
    const tx = buildErc20TransferTx(USDC_ADDRESS, FEE_RECIPIENT, oddAmount);
    const decoded = decodeFunctionData({ abi: erc20TransferAbi, data: tx.data as `0x${string}` });
    expect(decoded.args[1]).toBe(oddAmount);
  });
});
