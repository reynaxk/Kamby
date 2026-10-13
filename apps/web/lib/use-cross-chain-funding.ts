'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions';
import { useSignTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { wagmiConfig } from './wagmi-config';
import { moveStatus, quoteMove, submitSolanaMove, type BridgeChain } from './bridge-client';
import { useUsdcBalances } from './use-usdc-balance';
import { notifyTradeConfirmed } from './my-positions';

const DECIMALS: Record<BridgeChain, number> = { base: 6, bnb: 18, solana: 6 };
/** Every chain can fund every other (out of Solana Kamby's relayer pays the fee). */
const SOURCES: BridgeChain[] = ['base', 'bnb', 'solana'];
const MIN_MOVE_USD = 0.5;
const POLL_MS = 1500;
const TIMEOUT_MS = 120_000;

export type MoveStage = 'idle' | 'preparing' | 'signing' | 'moving' | 'done' | 'error';

/** Exported for tests. How much to move so a buy of `neededUsd` on `target` goes through —
 *  the shortfall plus a hair for rounding, never below the bridge's minimum. */
export function moveAmountUsd(neededUsd: number, haveUsd: number): number {
  const shortfall = neededUsd - haveUsd;
  if (!(shortfall > 0)) return 0;
  return Math.max(MIN_MOVE_USD, Math.ceil((shortfall * 1.005 + 0.01) * 100) / 100);
}

/** Exported for tests. The chain to pull from: the richest other chain that covers the move. */
export function pickSource(target: BridgeChain, moveUsd: number, balances: Partial<Record<BridgeChain, number | null>>): BridgeChain | null {
  const candidates = SOURCES.filter((c) => c !== target && (balances[c] ?? 0) >= moveUsd + 0.05);
  candidates.sort((a, b) => (balances[b] ?? 0) - (balances[a] ?? 0));
  return candidates[0] ?? null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function toRaw(usd: number, decimals: number): string {
  const cents = BigInt(Math.round(usd * 100));
  return (cents * 10n ** BigInt(decimals - 2)).toString();
}

/**
 * "One USDC" (owner, 2026-10-13): when a buy on `target` needs more USDC than the wallet holds
 * on that chain, the shortfall is moved over from another chain first — one tap, the user's
 * own wallet signs, Relay delivers in seconds. `neededUsd` is what the buy will spend.
 */
export function useCrossChainFunding(target: BridgeChain, neededUsd: number | null) {
  const { address: evmAddress } = useAccount();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const balances = useUsdcBalances(evmAddress, wallets[0]?.address);
  const have = balances[target];
  const moveUsd = neededUsd !== null && have !== null ? moveAmountUsd(neededUsd, have) : 0;
  const source = moveUsd > 0 ? pickSource(target, moveUsd, balances) : null;
  const [stage, setStage] = useState<MoveStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [feeUsd, setFeeUsd] = useState<number | null>(null);

  async function move(): Promise<void> {
    if (!source || moveUsd <= 0) throw new Error('Nothing to move');
    setError(null);
    setStage('preparing');
    try {
      const quote = await quoteMove({ from: source, to: target, amountOut: toRaw(moveUsd, DECIMALS[target]) });
      setFeeUsd(quote.feeUsd);
      setStage('signing');
      if (quote.solanaTxBase64) {
        // Out of Solana: the user signs; Kamby's relayer co-signs as fee payer and sends it.
        const wallet = wallets[0];
        if (!wallet) throw new Error('Your Solana wallet is still being set up — try again in a moment.');
        const { signedTransaction } = await signTransaction({ transaction: base64ToBytes(quote.solanaTxBase64), wallet });
        await submitSolanaMove(quote.requestId, bytesToBase64(signedTransaction));
      }
      for (const step of quote.steps) {
        if (getAccount(wagmiConfig).chainId !== step.chainId) await switchChain(wagmiConfig, { chainId: step.chainId as 8453 | 56 });
        const hash = await sendTransaction(wagmiConfig, {
          to: step.to as `0x${string}`,
          data: step.data as `0x${string}`,
          value: 0n,
          chainId: step.chainId as 8453 | 56,
          gas: step.gas ? (BigInt(step.gas) * 13n) / 10n : undefined,
        });
        // Approve first, then the deposit that spends it.
        await waitForTransactionReceipt(wagmiConfig, { hash, chainId: step.chainId as 8453 | 56, timeout: 60_000 });
      }
      setStage('moving');
      const startedAt = Date.now();
      for (;;) {
        const status = await moveStatus(quote.requestId);
        if (status === 'success') break;
        if (status === 'failure' || status === 'refund') throw new Error("The move didn't go through — your USDC is safe where it was.");
        if (Date.now() - startedAt > TIMEOUT_MS) throw new Error('The move is taking longer than usual — your USDC will arrive shortly. Try the buy again in a minute.');
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      notifyTradeConfirmed(); // refreshes every balance on screen
      setStage('done');
    } catch (err) {
      setStage('error');
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  return { balances, moveUsd, source, canCover: moveUsd > 0 && source !== null, stage, error, feeUsd, move };
}
