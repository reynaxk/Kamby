'use client';

import type { SolanaSocialActivity } from '@kamby/domain';
import { API_BASE } from './session-client';
import type { RealtimeStatus } from './social-client';

/**
 * Solana's counterpart to social-client.ts's activity-feed functions — same shape, same
 * "bare ping, client refetches" SSE contract (see docs/SOCIAL.md#realtime), pointed at the
 * real Solana endpoints (`GET /social/solana-activity`, `GET /social/solana-activity/stream`
 * — see SocialController's own comments on why these live there rather than under
 * `/solana/*`). Kept as its own file rather than added to social-client.ts: the two feeds
 * are genuinely separate data sources (confirmed `SolanaTradeTransaction` rows vs. indexed
 * EVM `Swap` rows), same reasoning solana-trading-client.ts is already separate from
 * trading-client.ts.
 */

export interface SolanaActivityPage {
  items: SolanaSocialActivity[];
  nextCursor: string | null;
}

export async function fetchLatestSolanaActivity(params: { cursor?: string; limit?: number }): Promise<SolanaActivityPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await fetch(`${API_BASE}/v1/social/solana-activity?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch Solana activity (${res.status})`);
  return res.json();
}

/**
 * Subscribes to the Solana activity SSE stream. Reconnection is deliberately left to the
 * browser's own built-in `EventSource` retry (it automatically reconnects on error using a
 * sane default/server-suggested delay) rather than adding a second, manual retry loop on
 * top — layering a hand-rolled `setTimeout` reconnect over an API that already retries
 * itself is what actually causes the "spamming reconnects" failure mode, not the lack of
 * one. `onStatus('reconnecting')` here is purely informational for the UI; it doesn't drive
 * any retry logic of its own. Returns an unsubscribe function.
 */
export function subscribeToSolanaActivityStream(onPing: () => void, onStatus: (status: RealtimeStatus) => void): () => void {
  onStatus('connecting');
  const source = new EventSource(`${API_BASE}/v1/social/solana-activity/stream`);

  source.addEventListener('solana-activity', () => onPing());
  source.addEventListener('heartbeat', () => onStatus('live'));
  source.onopen = () => onStatus('live');
  source.onerror = () => onStatus('reconnecting');

  return () => source.close();
}
