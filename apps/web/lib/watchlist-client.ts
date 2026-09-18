'use client';

import type { WatchlistPage } from '@kamby/domain';
import { authedFetch, expectOk, hasStoredSession } from './session-client';

/**
 * Phase 6 — client-side reads/mutations for token watchlists, same split as
 * lib/social-client.ts: a session lives only in this browser's localStorage, so watch
 * state/mutations structurally require a real browser-to-API call rather than a Server
 * Component. See docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 */

export { hasStoredSession };

/** `chainId` added 2026-09-16 for BNB Chain going live — omitted means "whichever chain
 *  this deployment defaults to" (Base), mirroring `apps/api`'s own optional `chainId`
 *  query param exactly (see `apps/api/src/market/dto/chain-id-query.dto.ts`). */
function watchUrl(address: string, chainId?: number): string {
  const suffix = chainId ? `?chainId=${chainId}` : '';
  return `/market/tokens/${encodeURIComponent(address)}/watch${suffix}`;
}

/** Never creates a session just to check — same contract as checkFollowStatus. A browser
 *  with no session can't be watching anything, so this is `false` without a network call. */
export async function checkWatchStatus(address: string, chainId?: number): Promise<boolean> {
  if (!hasStoredSession()) return false;
  try {
    const res = await authedFetch(watchUrl(address, chainId));
    if (!res.ok) return false;
    const body = (await res.json()) as { watching: boolean | null };
    return body.watching === true;
  } catch {
    return false;
  }
}

export async function watchToken(address: string, chainId?: number): Promise<void> {
  const res = await authedFetch(watchUrl(address, chainId), { method: 'POST' });
  await expectOk(res, 'watch this token');
}

export async function unwatchToken(address: string, chainId?: number): Promise<void> {
  const res = await authedFetch(watchUrl(address, chainId), { method: 'DELETE' });
  await expectOk(res, 'unwatch this token');
}

export async function fetchWatchlist(
  params: { cursor?: string; limit?: number } = {},
): Promise<WatchlistPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/social/watchlist?${query.toString()}`);
  await expectOk(res, 'load your watchlist');
  return res.json();
}
