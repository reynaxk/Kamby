'use client';

import type { MarketSummary, PumpFunTokenSummary } from '@kamby/domain';
import { API_BASE } from './session-client';

/**
 * Browser-side fetch client for `GET /v1/tokens/trenches` — see
 * docs/TRADING.md#pump-fun-trenches. Client-side (not lib/market-api.ts's server-only
 * pattern) because the terminal's trenches panel is itself a client component that needs
 * to refetch on tab switches without a full page round-trip, same reasoning
 * lib/solana-social-client.ts is separate from lib/market-api.ts.
 */

export type TrenchesCategory = 'FRESH' | 'NEAR_GRADUATED' | 'JUST_GRADUATED' | 'TRENDING_HOLDERS';

const PUMP_FUN_CATEGORIES: ReadonlySet<TrenchesCategory> = new Set(['FRESH', 'NEAR_GRADUATED', 'JUST_GRADUATED']);

export function isPumpFunCategory(category: TrenchesCategory): boolean {
  return PUMP_FUN_CATEGORIES.has(category);
}

class TrenchesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TrenchesApiError';
  }
}

/** The two categories are genuinely different shapes — see PumpFunTokenSummarySchema's own
 *  doc comment on why they're not forced into one. Callers branch on `isPumpFunCategory`
 *  (or the category they already know they requested) to know which array type comes back. */
export async function fetchTrenches(category: TrenchesCategory, limit = 20): Promise<MarketSummary[] | PumpFunTokenSummary[]> {
  const query = new URLSearchParams({ category, limit: String(limit) });
  const res = await fetch(`${API_BASE}/v1/tokens/trenches?${query.toString()}`);
  if (!res.ok) {
    throw new TrenchesApiError(`Trenches request for ${category} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MarketSummary[] | PumpFunTokenSummary[];
}
