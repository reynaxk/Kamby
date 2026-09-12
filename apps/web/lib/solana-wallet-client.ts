'use client';

import type { LinkedWallet, WalletChallenge } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Solana's counterpart to wallet-client.ts — see that file's own doc comment for the
 * shared "a connected wallet is only ever a claimed address until it signs a
 * server-issued challenge" principle.
 */

export async function requestSolanaWalletChallenge(address: string): Promise<WalletChallenge> {
  const res = await authedFetch('/identity/solana-wallet/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  await expectOk(res, 'start wallet verification');
  return res.json();
}

export async function verifySolanaWalletChallenge(nonce: string, signature: string): Promise<LinkedWallet> {
  const res = await authedFetch('/identity/solana-wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, signature }),
  });
  await expectOk(res, 'verify wallet ownership');
  return res.json();
}

export async function listLinkedSolanaWallets(): Promise<LinkedWallet[]> {
  const res = await authedFetch('/identity/solana-wallets');
  await expectOk(res, 'load linked wallets');
  return res.json();
}

export async function unlinkSolanaWallet(address: string): Promise<void> {
  const res = await authedFetch(`/identity/solana-wallets/${encodeURIComponent(address)}`, { method: 'DELETE' });
  await expectOk(res, 'unlink wallet');
}
