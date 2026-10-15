import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { LaunchEvmTx, LaunchProof } from '@kamby/domain';
import { encodeFunctionData, erc20Abi, isAddressEqual, type Hex, type PublicClient } from 'viem';
import { buildErc20TransferTx } from '../../trading/erc20-transfer';
import type { EvmGasTopupService } from '../../trading/evm-gas-topup.service';
import type { SwapRouter } from '../../trading/router/swap-router.interface';

export const NATIVE_COIN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
/** The smallest swap a funding step does — it also buys the create transaction's gas. */
const MIN_SWAP_USD = 1;
const SWAP_BUFFER = 1.02;

export interface EvmLaunchChain {
  chainId: number;
  client: PublicClient;
  router: SwapRouter;
  gas: EvmGasTopupService;
  usdc: { address: string; decimals: number };
  feeRecipient: `0x${string}`;
  /** Native coin kept for the create transaction's own gas. */
  gasReserveWei: bigint;
}

/** Wei of the chain's coin one US dollar buys right now (the router's price for $10 of USDC). */
export async function weiPerUsd(chain: EvmLaunchChain, wallet: string): Promise<number> {
  const quote = await chain.router.getQuote({ chainId: chain.chainId, sellToken: chain.usdc.address, buyToken: NATIVE_COIN, sellAmountRaw: (10n * 10n ** BigInt(chain.usdc.decimals)).toString(), taker: wallet, slippageBps: 100, feeRecipient: null, feeBps: 0 });
  const wei = quote ? Number(quote.buyAmountRaw) / 10 : NaN;
  if (!(wei > 0)) throw new UnprocessableEntityException("Couldn't price the network's coin right now — try again in a moment");
  return wei;
}

/**
 * The funding step of an EVM launch, sent from the creator's own wallet (Kamby's gas tank tops up
 * their gas first, as for trades): Kamby's fixed fee as a USDC transfer, then a swap of USDC for
 * the chain's coin the first buy and the create need (plus its approval, when needed).
 */
export async function buildEvmFunding(chain: EvmLaunchChain, wallet: `0x${string}`, devBuyUsd: number, feeUsd: number): Promise<{ txs: LaunchEvmTx[]; networkCostUsd: number; swapRaw: bigint }> {
  if ((await chain.gas.ensureGas(chain.chainId, wallet, chain.usdc)) === 'stranded') {
    throw new UnprocessableEntityException('Launching on this network is getting ready — try again in a few minutes.');
  }
  const perUsd = await weiPerUsd(chain, wallet);
  const balance = await chain.client.getBalance({ address: wallet });
  const neededWei = BigInt(Math.round(devBuyUsd * perUsd)) + chain.gasReserveWei;
  const shortUsd = neededWei > balance ? Number(neededWei - balance) / perUsd : 0;
  const swapUsd = Math.max(MIN_SWAP_USD, shortUsd * SWAP_BUFFER);
  const swapRaw = BigInt(Math.ceil(swapUsd * 10 ** chain.usdc.decimals));

  const quote = await chain.router.getQuote({ chainId: chain.chainId, sellToken: chain.usdc.address, buyToken: NATIVE_COIN, sellAmountRaw: swapRaw.toString(), taker: wallet, slippageBps: 100, feeRecipient: null, feeBps: 0 });
  if (!quote) throw new UnprocessableEntityException("Couldn't get a price for the swap right now — try again in a moment");

  const fee = buildErc20TransferTx(chain.usdc.address, chain.feeRecipient, BigInt(Math.round(feeUsd * 10 ** chain.usdc.decimals)));
  const txs: LaunchEvmTx[] = [{ chainId: chain.chainId, to: fee.to, data: fee.data, value: '0' }];
  if (quote.requiresApproval && quote.approvalSpender) {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [quote.approvalSpender as `0x${string}`, swapRaw] });
    txs.push({ chainId: chain.chainId, to: chain.usdc.address, data: approve, value: '0' });
  }
  txs.push({ chainId: chain.chainId, to: quote.unsignedTx.to, data: quote.unsignedTx.data, value: String(quote.unsignedTx.value ?? '0') });
  return { txs, networkCostUsd: Number(chain.gasReserveWei) / perUsd, swapRaw };
}

/** How much of the chain's coin the first buy can use now: the target, capped to what the wallet
 *  holds minus the create's gas. */
export async function devBuyWei(chain: EvmLaunchChain, wallet: `0x${string}`, devBuyUsd: number): Promise<bigint> {
  if (!(devBuyUsd > 0)) return 0n;
  const balance = await chain.client.getBalance({ address: wallet });
  const spendable = balance - chain.gasReserveWei;
  if (spendable <= 0n) throw new UnprocessableEntityException('Not enough funds for the launch yet — the swap may still be landing. Try again in a few seconds.');
  const target = BigInt(Math.round(devBuyUsd * (await weiPerUsd(chain, wallet))));
  return target > spendable ? spendable : target;
}

/** Every hash: sent by the creator, to the address, with the data and value handed out — and succeeded. */
export async function verifyEvmTxs(client: PublicClient, walletAddress: string, expected: LaunchEvmTx[], proof: LaunchProof): Promise<void> {
  const hashes = proof.txHashes ?? [];
  if (expected.length === 0 || hashes.length !== expected.length) throw new UnprocessableEntityException('Send every transaction of this step');
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i]!;
    const hash = hashes[i] as Hex;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
    if (!receipt) throw new UnprocessableEntityException("A transaction hasn't confirmed yet — check again in a minute.");
    const tx = await client.getTransaction({ hash });
    const matches =
      isAddressEqual(tx.from, walletAddress as `0x${string}`) &&
      tx.to !== null &&
      isAddressEqual(tx.to, want.to as `0x${string}`) &&
      tx.input.toLowerCase() === want.data.toLowerCase() &&
      tx.value === BigInt(want.value);
    if (!matches) throw new ForbiddenException("A transaction doesn't match the launch you prepared");
    if (receipt.status !== 'success') throw new UnprocessableEntityException('A transaction failed on-chain — nothing more was spent.');
  }
}
