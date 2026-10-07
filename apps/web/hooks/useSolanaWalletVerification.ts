'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSignMessage, useWallets } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import { hasStoredSession } from '@/lib/session-client';
import { listLinkedSolanaWallets, requestSolanaWalletChallenge, verifySolanaWalletChallenge } from '@/lib/solana-wallet-client';
import { claimAutoAttempt, isVerified, onVerified, verifyOnce } from '@/lib/wallet-verification-registry';

export type SolanaWalletVerificationStatus = 'disconnected' | 'checking' | 'unverified' | 'verifying' | 'verified' | 'rejected';

/**
 * Solana's counterpart to useWalletVerification.ts — see that hook's own doc comment for
 * the shared "a connected wallet is never treated as proof of anything; trading is gated
 * on status === 'verified'" principle, the "never mints a session just to check" ordering,
 * and the automatic-verification behavior (2026-09-30) this hook shares.
 *
 * Written against Privy's React SDK as documented at the time this was built (`useWallets`/
 * `useSignMessage` from `@privy-io/react-auth/solana`, `signMessage({ message, wallet })`
 * returning a raw signature encoded here via `bs58`); re-verify against Privy's current
 * docs (https://docs.privy.io) before depending on this in production, same caveat this
 * codebase already carries for its other third-party integrations (KyberSwapRouter,
 * JupiterQuoteService, privy-config.ts).
 */
export function useSolanaWalletVerification() {
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const wallet = wallets[0];
  const address = wallet?.address;
  const key = address ? `solana:${address}` : null;

  const [status, setStatus] = useState<SolanaWalletVerificationStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !key) {
      setStatus('disconnected');
      return;
    }
    if (isVerified(key)) {
      setStatus('verified');
      return;
    }
    if (!hasStoredSession()) {
      setStatus('unverified');
      return;
    }
    setStatus('checking');
    try {
      const linkedWallets = await listLinkedSolanaWallets();
      const linked = linkedWallets.some((w) => w.address === address);
      setStatus(linked ? 'verified' : 'unverified');
    } catch {
      setStatus('unverified');
    }
  }, [address, key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => (key ? onVerified((verifiedKey) => verifiedKey === key && setStatus('verified')) : undefined), [key]);

  const verify = useCallback(async () => {
    if (!address || !wallet || !key) return;
    setStatus('verifying');
    setError(null);
    try {
      await verifyOnce(key, async () => {
        const challenge = await requestSolanaWalletChallenge(address);
        const { signature } = await signMessage({ message: new TextEncoder().encode(challenge.message), wallet });
        await verifySolanaWalletChallenge(challenge.nonce, bs58.encode(signature));
      });
      setStatus('verified');
    } catch (err) {
      setStatus('rejected');
      setError(err instanceof Error ? err.message : 'Wallet verification failed');
    }
  }, [address, wallet, key, signMessage]);

  useEffect(() => {
    if (status === 'unverified' && key && claimAutoAttempt(key)) void verify();
  }, [status, key, verify]);

  return { status, error, verify, isConnected: Boolean(address), address };
}
