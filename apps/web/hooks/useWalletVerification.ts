'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { hasStoredSession } from '@/lib/session-client';
import { listLinkedWallets, requestWalletChallenge, verifyWalletChallenge } from '@/lib/wallet-client';
import { claimAutoAttempt, isVerified, onVerified, verifyOnce } from '@/lib/wallet-verification-registry';

export type WalletVerificationStatus = 'disconnected' | 'checking' | 'unverified' | 'verifying' | 'verified' | 'rejected';

/**
 * Drives the SIWE-style ownership flow (see docs/TRADING.md#wallet-ownership) for whichever
 * wallet wagmi currently has connected. A connected address is never treated as proof of
 * anything — trading is gated on `status === 'verified'`, which only happens after this
 * API's own challenge has been signed and checked server-side.
 *
 * Automatic as of 2026-09-30 (the user asked to remove the "Verify wallet" step): as soon
 * as a connected wallet is found unverified, the challenge is signed without a click.
 * Kamby's own embedded wallets sign silently (`showWalletUIs: false` in lib/privy-config.ts),
 * so for most users verification is invisible; an external wallet shows its own one-time
 * signature prompt. The automatic attempt runs once per page load per wallet (see
 * lib/wallet-verification-registry.ts), and `verify()` stays available as a manual retry.
 */
export function useWalletVerification() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<WalletVerificationStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const key = address ? `evm:${address.toLowerCase()}` : null;

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
      const wallets = await listLinkedWallets();
      const linked = wallets.some((w) => w.address.toLowerCase() === address.toLowerCase());
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
    if (!address || !key) return;
    setStatus('verifying');
    setError(null);
    try {
      await verifyOnce(key, async () => {
        const challenge = await requestWalletChallenge(address);
        const signature = await signMessageAsync({ message: challenge.message });
        await verifyWalletChallenge(challenge.nonce, signature);
      });
      setStatus('verified');
    } catch (err) {
      setStatus('rejected');
      setError(err instanceof Error ? err.message : 'Wallet verification failed');
    }
  }, [address, key, signMessageAsync]);

  useEffect(() => {
    if (status === 'unverified' && key && claimAutoAttempt(key)) void verify();
  }, [status, key, verify]);

  return { status, error, verify, isConnected, address };
}
