'use client';

import type {
  PersonalizedFeedPage,
  PersonalizedToken,
  PnlHistory,
  SavedSearchDto,
  TokenPosition,
  TokenThesis,
  TokenTraderConnection,
  WhatsMissed,
} from '@kamby/domain';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/**
 * Phase 5 — client-side reads for the personalized endpoints, same split as
 * lib/social-client.ts vs lib/social-api.ts: personalization requires a session, which only
 * exists in this browser's localStorage. See docs/TRADER_INTELLIGENCE.md.
 */

export { hasStoredSession };

/** Returns an empty list rather than lazily starting a session — viewing the discover page
 *  must never itself create one (see lib/session-client.ts#ensureSessionToken). Callers
 *  should gate on hasStoredSession() before calling this, same as every other
 *  first-authenticated-read in this app. */
export async function fetchPersonalizedDiscovery(limit = 12): Promise<PersonalizedToken[]> {
  if (!hasStoredSession()) return [];
  const res = await authedFetch(`/discovery/personalized?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchPersonalizedFeed(
  params: { cursor?: string; limit?: number } = {},
): Promise<PersonalizedFeedPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/discovery/feed?${query.toString()}`);
  await expectOk(res, 'load your personalized feed');
  return res.json();
}

// ---------------------------------------------------------------------------------------
// Phase 6 — saved searches, see docs/PHASE6_RETENTION_SOCIAL.md#saved-searches.
// ---------------------------------------------------------------------------------------

export async function fetchSavedSearches(): Promise<SavedSearchDto[]> {
  if (!hasStoredSession()) return [];
  const res = await authedFetch('/discovery/saved-searches');
  if (!res.ok) return [];
  return res.json();
}

export async function createSavedSearch(
  query: string,
  displayName?: string,
): Promise<SavedSearchDto> {
  const res = await authedFetch('/discovery/saved-searches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, displayName: displayName || undefined }),
  });
  await expectOk(res, 'save this search');
  return res.json();
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const res = await authedFetch(`/discovery/saved-searches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await expectOk(res, 'delete this saved search');
}

// ---------------------------------------------------------------------------------------
// Phase 6 — return loop / streak, see docs/PHASE6_RETENTION_SOCIAL.md#return-loop.
// ---------------------------------------------------------------------------------------

/** Never creates a session just to check — an anonymous visitor has nothing to have missed. */
export async function fetchWhatsMissed(): Promise<WhatsMissed | null> {
  if (!hasStoredSession()) return null;
  const res = await authedFetch('/discovery/whats-missed');
  if (!res.ok) return null;
  return res.json();
}

/** Called once per discover-page visit by a browser that already has a session — never
 *  creates one itself (see hasStoredSession gate in the caller), matching every other
 *  "must never itself start a session" rule in this app. */
export async function markDiscoverySeen(): Promise<{
  currentStreakDays: number;
  longestStreakDays: number;
} | null> {
  const res = await authedFetch('/discovery/mark-seen', { method: 'POST' });
  if (!res.ok) return null;
  return res.json();
}

const EMPTY_TOKEN_TRADER_CONNECTION: TokenTraderConnection = {
  uniqueTraders24h: null,
  recentTraders: [],
  activeTraders: [],
  recentLargeTrades: [],
  watcherCount: 0,
  buyCount24h: 0,
  sellCount24h: 0,
  buyerCount24h: 0,
  sellerCount24h: 0,
};

/**
 * Client-safe counterpart to lib/discovery-api.ts's fetchTokenTraders, for Discover's
 * in-place terminal (components/discovery/DiscoverTerminal.tsx). An unauthenticated read
 * (same as the server version) — deliberately a plain fetch, not authedFetch, since viewing
 * Discover must never itself create a session (same rule fetchLatestActivity in
 * social-client.ts already follows).
 *
 * Requires chainId explicitly, unlike the server-side version — Discover's own lists are
 * genuinely cross-chain, so silently defaulting to Base here would misattribute traders for
 * every non-Base selection (see the fix in lib/discovery-api.ts's own fetchTokenTraders).
 */
export async function fetchTokenTraders(address: string, chainId: number, limit = 10): Promise<TokenTraderConnection> {
  const query = new URLSearchParams({ chainId: String(chainId), limit: String(limit) });
  const res = await fetch(`${API_BASE}/v1/market/tokens/${encodeURIComponent(address)}/traders?${query.toString()}`);
  if (res.status === 404) return EMPTY_TOKEN_TRADER_CONNECTION;
  if (!res.ok) throw new Error(`Failed to fetch token traders (${res.status})`);
  return res.json();
}

/** An unauthenticated read, same reasoning as fetchTokenTraders above — viewing a token's
 *  theses must never itself create a session. */
export async function fetchTheses(address: string, chainId: number, limit = 20): Promise<TokenThesis[]> {
  const query = new URLSearchParams({ chainId: String(chainId), limit: String(limit) });
  const res = await fetch(`${API_BASE}/v1/social/tokens/${encodeURIComponent(address)}/theses?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch theses (${res.status})`);
  return res.json();
}

/** Writing a thesis is the one genuinely authenticated action here — authedFetch creates a
 *  session transparently if this browser doesn't have one yet, same as followTrader in
 *  social-client.ts. */
export async function setMyThesis(address: string, chainId: number, text: string): Promise<TokenThesis> {
  const query = new URLSearchParams({ chainId: String(chainId) });
  const res = await authedFetch(`/social/tokens/${encodeURIComponent(address)}/thesis?${query.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await expectOk(res, 'set thesis');
  return res.json();
}

/** The signed-in user's own open positions — see PositionService.getMine's own doc comment
 *  for exactly what "open" means. Returns an empty list for an unauthenticated browser
 *  rather than lazily starting a session, same reasoning as fetchPersonalizedDiscovery
 *  above: viewing the terminal must never itself create a session. */
export async function fetchMyPositions(): Promise<TokenPosition[]> {
  if (!hasStoredSession()) return [];
  const res = await authedFetch('/social/positions');
  if (!res.ok) throw new Error(`Failed to fetch positions (${res.status})`);
  return res.json();
}

/** Same "never create a session just to view" guard as fetchMyPositions — an empty
 *  zero-day-range history rather than a real fetch/error for a browser with no session. */
export async function fetchMyPnlHistory(days = 30): Promise<PnlHistory> {
  if (!hasStoredSession()) return { days, points: [] };
  const res = await authedFetch(`/social/pnl-history?days=${days}`);
  if (!res.ok) throw new Error(`Failed to fetch PnL history (${res.status})`);
  return res.json();
}
