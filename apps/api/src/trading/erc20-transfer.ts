import type { UnsignedTransaction } from '@kamby/domain';
import { encodeFunctionData } from 'viem';

/** The one ERC-20 call this file ever builds — a plain `transfer(address,uint256)`, never
 *  approve/transferFrom. Kept minimal and local to the guaranteed-USDC-fee flow (see
 *  docs/TRADING.md#fees) rather than added to packages/chain-adapters' ABIs, which are
 *  read-only by design. */
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

/**
 * Builds an unsigned `transfer(to, amountRaw)` call against `tokenAddress` — used to move
 * the platform fee as a separate, plain USDC transfer instead of relying on an
 * aggregator's built-in (and not-necessarily-USDC) fee cut. See
 * docs/TRADING.md#guaranteed-usdc-fees. `gas`/`maxFeePerGas`/`maxPriorityFeePerGas` are left
 * `null` — the wallet estimates these at signing time, same convention `KyberSwapRouter`
 * uses for fields its own quote didn't supply.
 */
export function buildErc20TransferTx(tokenAddress: string, to: string, amountRaw: bigint): UnsignedTransaction {
  return {
    to: tokenAddress,
    data: encodeFunctionData({
      abi: erc20TransferAbi,
      functionName: 'transfer',
      args: [to as `0x${string}`, amountRaw],
    }),
    value: '0',
    gas: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };
}
