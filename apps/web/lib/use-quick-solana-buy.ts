'use client';

import { useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useTranslations } from 'next-intl';
import { MIN_TRADE_USD } from '@kamby/domain';
import { useTerminalToast } from '@/components/terminal/ToastProvider';
import { useSolanaWalletVerification } from '@/hooks/useSolanaWalletVerification';
import { friendlyError } from '@/lib/friendly-error';
import { notifyTradeConfirmed } from '@/lib/my-positions';
import { getSolanaTransaction, getSponsoredSolanaQuote, submitSponsoredSolanaTransaction } from '@/lib/solana-trading-client';
import { useCrossChainFunding } from '@/lib/use-cross-chain-funding';

/** Snipes move fast: 10% (the top of the panel's Auto range for brand-new coins is 15%). */
const QUICK_SLIPPAGE_BPS = 1_000;
/** Same stop as the panel's one-tap: a buy that moves the price 10%+ needs a look first. */
const MAX_IMPACT_BPS = 1_000;

function b64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * ⚡ Quick buy (owner 2026-10-28, "for the snipers — ultra fast"): one tap on a card buys
 * `amountUsd` of a Solana coin. The same gasless path as the trade panel's one-tap — a sponsored
 * quote, the user's wallet signs, Kamby's relayer pays the fee and sends — with the shortfall
 * moved over from Base/BNB first when Solana's USDC is short. Progress lives in a toast, so the
 * grid stays put. Must render inside a ToastProvider.
 */
export function useQuickSolanaBuy(amountUsd: number) {
  const t = useTranslations('xxxrisk');
  const tTrade = useTranslations('trade');
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const verification = useSolanaWalletVerification();
  const { signTransaction } = useSignTransaction();
  const toast = useTerminalToast();
  const funding = useCrossChainFunding('solana', amountUsd);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function buy(mint: string, label: string) {
    if (busyRef.current) return;
    if (!authenticated) return login();
    if (!(amountUsd >= MIN_TRADE_USD)) {
      toast.push({ variant: 'error', title: t('minBuy', { min: MIN_TRADE_USD }) });
      return;
    }
    if (!wallet || verification.status !== 'verified') {
      if (verification.status === 'unverified' || verification.status === 'rejected') void verification.verify();
      toast.push({ variant: 'error', title: t('walletSetup') });
      return;
    }
    busyRef.current = true;
    setBusy(mint);
    const id = toast.push({ variant: 'pending', title: t('buying', { token: label }), description: `$${amountUsd}` });
    try {
      const have = funding.balances.solana;
      if (have !== null && have < amountUsd) {
        if (!funding.canCover) throw new Error(t('notEnough'));
        toast.update(id, { description: t('moving') });
        await funding.move();
      }
      const quote = await getSponsoredSolanaQuote({
        side: 'BUY',
        tokenMint: mint,
        walletAddress: wallet.address,
        amount: String(Math.round(amountUsd * 100) * 10_000),
        slippageBps: QUICK_SLIPPAGE_BPS,
      });
      if ((quote.priceImpactBps ?? 0) >= MAX_IMPACT_BPS) throw new Error(t('impactHigh'));
      toast.update(id, { description: tTrade('confirmInWalletDots') });
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(quote.unsignedTxBase64), wallet });
      const tx = await submitSponsoredSolanaTransaction({ quoteId: quote.id, walletAddress: wallet.address, partiallySignedTxBase64: bytesToB64(signedTransaction) });
      const solscanUrl = `https://solscan.io/tx/${tx.signature}`;
      toast.update(id, { title: tTrade('toastSubmitted'), description: tTrade('toastWaitingNetwork'), solscanUrl });
      const startedAt = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 1_000));
        const latest = await getSolanaTransaction(tx.id).catch(() => null);
        if (latest?.status === 'CONFIRMED') {
          notifyTradeConfirmed();
          toast.update(id, { variant: 'success', title: t('bought', { token: label }), description: `$${amountUsd}`, solscanUrl });
          break;
        }
        if (latest?.status === 'FAILED' || latest?.status === 'EXPIRED') throw new Error(latest.failureReason ?? tTrade('toastFailed'));
        if (Date.now() - startedAt > 60_000) {
          toast.update(id, { variant: 'success', title: tTrade('toastSubmitted'), description: tTrade('toastWaitingNetwork'), solscanUrl });
          break;
        }
      }
    } catch (err) {
      toast.update(id, { variant: 'error', title: tTrade('toastFailed'), description: friendlyError(err) });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return { buy, busy };
}
