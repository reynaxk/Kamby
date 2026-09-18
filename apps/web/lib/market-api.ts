import type { Candle, DiscoverSort, MarketSummary, Timeframe } from '@kamby/domain';
import { env } from './env';

/**
 * The only place apps/web talks to the outside world for market data — always the API,
 * never the chain directly (see docs/SOURCE_OF_TRUTH.md). Every call runs server-side
 * (Server Components / Route Handlers), so `API_BASE_URL` never reaches the browser.
 */

class MarketApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MarketApiError';
  }
}

/** Exported for lib/social-api.ts — same server-only fetch convention, one API base URL. */
export async function apiGet<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  const res = await fetch(`${env.API_BASE_URL}/v1${path}`, { next: { revalidate: revalidateSeconds } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new MarketApiError(`Market API request to ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export interface DiscoverParams {
  sort?: DiscoverSort;
  limit?: number;
  search?: string;
}

export async function fetchDiscoverMarkets(params: DiscoverParams = {}): Promise<MarketSummary[]> {
  const query = new URLSearchParams();
  if (params.sort) query.set('sort', params.sort);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search) query.set('search', params.search);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await apiGet<MarketSummary[]>(`/market/discover${suffix}`, 20);
  return result ?? [];
}

/** Returns null only when the token genuinely isn't tracked — callers should render a
 *  "not found" state, not conflate it with a backend error (that throws instead).
 *  `chainId` added 2026-09-16 for BNB Chain going live — omitted means "whichever chain
 *  this deployment defaults to" (Base), mirroring `apps/api`'s own optional `chainId` DTO
 *  field exactly (see `apps/api/src/market/dto/chain-id-query.dto.ts`). The real
 *  `/market/[chain]/[address]` route always passes one explicitly. */
export async function fetchToken(address: string, chainId?: number): Promise<MarketSummary | null> {
  const suffix = chainId ? `?chainId=${chainId}` : '';
  return apiGet<MarketSummary>(`/market/tokens/${encodeURIComponent(address)}${suffix}`, 15);
}

export async function fetchTokenHistory(address: string, timeframe: Timeframe, chainId?: number): Promise<Candle[]> {
  const query = new URLSearchParams({ timeframe });
  if (chainId) query.set('chainId', String(chainId));
  const result = await apiGet<Candle[]>(
    `/market/tokens/${encodeURIComponent(address)}/history?${query.toString()}`,
    30,
  );
  return result ?? [];
}

export async function fetchSearch(query: string, limit?: number): Promise<MarketSummary[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  const result = await apiGet<MarketSummary[]>(`/market/search?${params.toString()}`, 10);
  return result ?? [];
}
