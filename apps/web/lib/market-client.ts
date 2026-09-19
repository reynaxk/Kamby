'use client';

import type { Candle, Timeframe } from '@kamby/domain';
import { API_BASE } from './session-client';

/**
 * Client-safe counterpart to lib/market-api.ts's fetchTokenHistory — same split
 * lib/social-api.ts/lib/social-client.ts already established: the server version builds its
 * URL from the server-only env.API_BASE_URL, so it can't be called from a Client Component.
 * Added for Discover's in-place terminal (components/discovery/DiscoverTerminal.tsx), which
 * needs to refetch a freshly-selected token's candles from the browser, not just once
 * server-side per page load.
 */
export async function fetchTokenHistory(address: string, timeframe: Timeframe, chainId?: number): Promise<Candle[]> {
  const query = new URLSearchParams({ timeframe });
  if (chainId) query.set('chainId', String(chainId));
  const res = await fetch(`${API_BASE}/v1/market/tokens/${encodeURIComponent(address)}/history?${query.toString()}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to fetch candles (${res.status})`);
  return res.json();
}
