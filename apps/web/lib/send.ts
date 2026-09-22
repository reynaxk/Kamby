'use client';

import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  type Connection,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { erc20Abi, isAddress } from 'viem';
import { estimateGas, getGasPrice, readContract, sendTransaction, writeContract } from 'wagmi/actions';
import { isEvmAddress, isSolanaAddress, SOLANA_USDC_MINT, type EvmChainConfig } from '@kamby/domain';
import { wagmiConfig } from './wagmi-config';

/**
 * Chain-agnostic building blocks for the Send modal (components/wallet/SendModal.tsx) — a
 * plain wallet-to-wallet transfer from the user's own already-connected wallet to an
 * arbitrary destination they type in, never a Kamby-custodied balance (see this app's
 * non-custodial-by-design principle: docs/WALLET_SECURITY.md). Every amount here is a raw
 * integer string (pre-decimals), same "never a JS float for a real on-chain amount"
 * discipline as SolAmountInput.tsx/UsdPresetAmountInput.tsx.
 */

export type SendChainSlug = 'solana' | 'base' | 'bnb';
export type SendChainKind = 'solana' | 'evm';

export interface SendChainOption {
  slug: SendChainSlug;
  kind: SendChainKind;
  name: string;
  nativeSymbol: string;
  /** Only present for `kind: 'evm'` — the real wagmi/viem chain id. */
  evmChainId?: 8453 | 56;
  explorerName: string;
  txExplorerUrl: (hash: string) => string;
}

export const SEND_CHAINS: SendChainOption[] = [
  {
    slug: 'solana',
    kind: 'solana',
    name: 'Solana',
    nativeSymbol: 'SOL',
    explorerName: 'Solscan',
    txExplorerUrl: (sig) => `https://solscan.io/tx/${sig}`,
  },
  {
    slug: 'base',
    kind: 'evm',
    name: 'Base',
    nativeSymbol: 'ETH',
    evmChainId: 8453,
    explorerName: 'Basescan',
    txExplorerUrl: (hash) => `https://basescan.org/tx/${hash}`,
  },
  {
    slug: 'bnb',
    kind: 'evm',
    name: 'BNB Chain',
    nativeSymbol: 'BNB',
    evmChainId: 56,
    explorerName: 'BscScan',
    txExplorerUrl: (hash) => `https://bscscan.com/tx/${hash}`,
  },
];

export interface SendAsset {
  kind: 'native' | 'token';
  symbol: string;
  /** Token contract address (EVM) or mint address (Solana) — absent for the native asset. */
  address?: string;
  /** Only ever hardcoded for a protocol-level constant (native SOL's 9, or this app's own
   *  single well-known SOLANA_USDC_MINT, matching UsdPresetAmountInput.tsx/
   *  SolAmountInput.tsx's own established convention) — an EVM token's decimals are never
   *  guessed here, since its contract address itself isn't a hardcoded constant (see
   *  `readEvmTokenDecimals` below, always called for an EVM `SendAsset`). `null` means "not
   *  resolved yet."
   */
  decimals: number | null;
}

/** The asset list for a chosen chain — native currency always first, plus USDC when a real
 *  USDC address/mint is known for that chain. `evmChainConfigs` comes from GET
 *  /market/chains (lib/market-client.ts's fetchEvmChainConfigs) — the exact same addresses
 *  every trading service already trades against, never a second, independently-sourced
 *  address hardcoded here (see EvmChainConfigSchema's own doc comment in @kamby/domain). */
export function assetsForChain(chain: SendChainOption, evmChainConfigs: EvmChainConfig[]): SendAsset[] {
  const native: SendAsset = { kind: 'native', symbol: chain.nativeSymbol, decimals: chain.kind === 'solana' ? 9 : 18 };
  if (chain.kind === 'solana') {
    return [native, { kind: 'token', symbol: 'USDC', address: SOLANA_USDC_MINT, decimals: 6 }];
  }
  const config = evmChainConfigs.find((c) => c.chainId === chain.evmChainId);
  if (!config) return [native];
  return [native, { kind: 'token', symbol: 'USDC', address: config.usdcAddress, decimals: null }];
}

/** Layered validation for a typed-or-pasted destination — format regex (@kamby/domain's
 *  isEvmAddress/isSolanaAddress) plus a real decode/checksum check, since a wrong-but-
 *  format-passing address here is unrecoverable (non-custodial, no reversal, no support
 *  desk that can claw funds back).
 *
 *  `isAddress(trimmed)` — strict mode is viem's *default*, not an option this passes
 *  explicitly — genuinely verifies an EIP-55 checksum on a mixed-case string (catching a
 *  single fat-fingered hex digit's case) while still accepting a correctly-shaped
 *  all-lowercase address, which carries no checksum info to verify at all. This replaced an
 *  earlier, real bug here: `getAddress()` (viem's checksum *formatter*, not a validator)
 *  unconditionally recomputes the correct checksum from `address.toLowerCase()` regardless
 *  of the input's own casing and never throws on a mismatched one — wrapping it in
 *  try/catch silently validated nothing beyond the bare regex. Caught by this file's own
 *  test suite (lib/send.test.ts), not by inspection — worth remembering why `isAddress` is
 *  the one used here, not `getAddress`.
 *
 *  `new PublicKey(...)` throws on base58 that doesn't actually decode to a real 32-byte
 *  curve point. */
export function isValidDestination(chainKind: SendChainKind, input: string): boolean {
  const trimmed = input.trim();
  if (chainKind === 'evm') {
    return isEvmAddress(trimmed) && isAddress(trimmed);
  }
  if (!isSolanaAddress(trimmed)) return false;
  try {
    void new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Always reads the real, current decimals on-chain — never assumed. Circle's own USDC is 6
 *  decimals on most chains, but a re-issued/bridged token carrying the same "USDC" symbol
 *  can genuinely differ (e.g. BNB Chain's Binance-Peg USD Coin mints at 18, not 6) — the
 *  one place in this whole flow where guessing wrong silently sends 10^12x the intended
 *  amount, so this is never worth hardcoding. */
export async function readEvmTokenDecimals(tokenAddress: string, chainId: 8453 | 56): Promise<number> {
  return readContract(wagmiConfig, {
    address: tokenAddress as `0x${string}`,
    abi: erc20Abi,
    functionName: 'decimals',
    chainId,
  });
}

/** A real gas estimate for a plain native send to this exact destination, with a 50% buffer
 *  — the same margin this codebase already relies on elsewhere for EVM gas (see
 *  wagmi-config.ts's BNB Chain notes) — so "Max" can never leave the wallet unable to pay
 *  for the very transaction sending it. Falls back to a generous fixed reserve if
 *  estimation itself fails (an RPC hiccup must never silently become "no reserve at all"). */
export async function estimateNativeSendReserve(chainId: 8453 | 56, to: `0x${string}`): Promise<bigint> {
  try {
    const [gas, gasPrice] = await Promise.all([
      estimateGas(wagmiConfig, { to, value: 1n, chainId }),
      getGasPrice(wagmiConfig, { chainId }),
    ]);
    return (gas * gasPrice * 150n) / 100n;
  } catch {
    return chainId === 56 ? 3_000_000_000_000_000n : 500_000_000_000_000n; // 0.003 BNB / 0.0005 ETH
  }
}

export async function sendEvmNative(to: `0x${string}`, amountRaw: bigint, chainId: 8453 | 56): Promise<`0x${string}`> {
  return sendTransaction(wagmiConfig, { to, value: amountRaw, chainId });
}

export async function sendEvmToken(
  tokenAddress: `0x${string}`,
  to: `0x${string}`,
  amountRaw: bigint,
  chainId: 8453 | 56,
): Promise<`0x${string}`> {
  return writeContract(wagmiConfig, {
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amountRaw],
    chainId,
  });
}

/** SOL's own transaction fee is a fixed, tiny, protocol-level amount (~0.000005 SOL for a
 *  simple transfer) — unlike EVM gas, it needs no live estimate; this reserve is the same
 *  order-of-magnitude headroom SolAmountInput.tsx's own FEE_RESERVE_LAMPORTS already uses. */
export const SOLANA_FEE_RESERVE_LAMPORTS = 10_000_000n; // 0.01 SOL

export async function buildSolanaNativeTransferTx(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  lamports: bigint,
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Number(lamports) }));
  return tx;
}

/** Includes an idempotent "create destination's associated token account if it doesn't
 *  already exist" instruction before the transfer itself — a bare transfer instruction
 *  fails outright against a destination with no token account for this mint yet, which is
 *  the single most common way a first SPL transfer to a fresh wallet breaks. Idempotent
 *  means this is a real no-op (not an error) when the account already exists. */
export async function buildSolanaTokenTransferTx(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  amountRaw: bigint,
): Promise<Transaction> {
  const [fromAta, toAta] = await Promise.all([getAssociatedTokenAddress(mint, from), getAssociatedTokenAddress(mint, to)]);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight });
  tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint));
  tx.add(createTransferInstruction(fromAta, toAta, from, amountRaw));
  return tx;
}

export function nativeAmountToDecimalString(chain: SendChainOption): number {
  return chain.kind === 'solana' ? LAMPORTS_PER_SOL : 1e18;
}
