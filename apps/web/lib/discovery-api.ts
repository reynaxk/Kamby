import type {
  RisingToken,
  RisingTrader,
  SocialActivity,
  TokenTraderConnection,
  TopTrader,
  TraderTokenStat,
} from '@kamby/domain';
import { apiGet } from './market-api';

/**
 * Phase 5 — server-side reads for trader intelligence & discovery, same convention as
 * market-api.ts/social-api.ts (always through the API, always server-side). See
 * docs/TRADER_INTELLIGENCE.md. Personalized endpoints require a session and so live in
 * lib/discovery-client.ts instead (client-side, same split social-api.ts/social-client.ts
 * already established).
 */

export async function fetchActiveTraders(limit = 10): Promise<TopTrader[]> {
  const result = await apiGet<TopTrader[]>(`/discovery/active-traders?limit=${limit}`, 30);
  return result ?? [];
}

export async function fetchLargeTrades(limit = 20): Promise<SocialActivity[]> {
  const result = await apiGet<SocialActivity[]>(`/discovery/large-trades?limit=${limit}`, 30);
  return result ?? [];
}

export interface RisingResult {
  tokens: RisingToken[];
  traders: RisingTrader[];
}

export async function fetchRising(limit = 10): Promise<RisingResult> {
  const result = await apiGet<RisingResult>(`/discovery/rising?limit=${limit}`, 30);
  return result ?? { tokens: [], traders: [] };
}

export async function fetchTraderTokens(address: string, limit = 20): Promise<TraderTokenStat[]> {
  const result = await apiGet<TraderTokenStat[]>(
    `/social/traders/${encodeURIComponent(address)}/tokens?limit=${limit}`,
    20,
  );
  return result ?? [];
}

/** `chainId` optional only for back-compat with the one pre-existing call site that didn't
 *  pass it (a real, previously-silent bug — every call defaulted to Base's copy of whatever
 *  address it was given, per apps/api's own `query.chainId ?? DEFAULT_CHAIN_ID` fallback).
 *  New callers should always pass it explicitly. */
export async function fetchTokenTraders(
  address: string,
  chainId?: number,
  limit = 10,
): Promise<TokenTraderConnection> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (chainId) query.set('chainId', String(chainId));
  const result = await apiGet<TokenTraderConnection>(
    `/market/tokens/${encodeURIComponent(address)}/traders?${query.toString()}`,
    20,
  );
  return (
    result ?? {
      uniqueTraders24h: null,
      recentTraders: [],
      activeTraders: [],
      recentLargeTrades: [],
      watcherCount: 0,
    }
  );
}
