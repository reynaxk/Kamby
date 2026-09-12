'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSignMessage, useWallets } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import { ensureSolanaWalletFunded } from '@/lib/solana-trading-client';
import { hasStoredSession } from '@/lib/session-client';
import { listLinkedSolanaWallets, requestSolanaWalletChallenge, verifySolanaWalletChallenge } from '@/lib/solana-wallet-client';

export type SolanaWalletVerificationStatus = 'disconnected' | 'checking' | 'unverified' | 'verifying' | 'verified' | 'rejected';

/**
 * Solana's counterpart to useWalletVerification.ts — see that hook's own doc comment for
 * the shared "a connected wallet is never treated as proof of anything; trading is gated
 * on status === 'verified'" principle, and the "never mints a session just to check"
 * ordering.
 *
 * Written against Privy's React SDK as documented at the time this was built (`useWallets`/
 * `useSignMessage` from `@privy-io/react-auth/solana`, `signMessage({ message, wallet })`
 * returning a raw signature encoded here via `bs58`); re-verify against Privy's current
 * docs (https://docs.privy.io) before depending on this in production, same caveat this
 * codebase already carries for its other third-party integrations (LiFiSwapRouter,
 * JupiterQuoteService, privy-config.ts).
 */
export function useSolanaWalletVerification() {
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const wallet = wallets[0];
  const address = wallet?.address;

  const [status, setStatus] = useState<SolanaWalletVerificationStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setStatus('disconnected');
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
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verify = useCallback(async () => {
    if (!address || !wallet) return;
    setStatus('verifying');
    setError(null);
    try {
      const challenge = await requestSolanaWalletChallenge(address);
      const { signature } = await signMessage({ message: new TextEncoder().encode(challenge.message), wallet });
      await verifySolanaWalletChallenge(challenge.nonce, bs58.encode(signature));
      setStatus('verified');
      // A failed top-up is never fatal to verification succeeding — see
      // SolanaTopupService's own doc comment on why a funding shortfall doesn't block the
      // user from proceeding (they'll just need to fund the wallet themselves if it fails).
      void ensureSolanaWalletFunded(address).catch(() => undefined);
    } catch (err) {
      setStatus('rejected');
      setError(err instanceof Error ? err.message : 'Wallet verification failed');
    }
  }, [address, wallet, signMessage]);

  return { status, error, verify, isConnected: Boolean(address), address };
}
