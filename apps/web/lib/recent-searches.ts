'use client';

/**
 * Coins you opened from search, newest first (2026-10-10, like fomo's "Recents") — kept in this
 * browser only (a convenience, not account data), at most 8.
 */
export interface RecentSearch {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
}

const KEY = 'kamby:recent-searches';
const MAX = 8;
export const RECENTS_CHANGED_EVENT = 'kamby:recents-changed';

export function readRecentSearches(): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as RecentSearch[]).filter((r) => r && typeof r.tokenAddress === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(item: RecentSearch): void {
  try {
    const rest = readRecentSearches().filter((r) => !(r.chainIdentifier === item.chainIdentifier && r.tokenAddress === item.tokenAddress));
    const { chainIdentifier, tokenAddress, symbol, name, logoUrl } = item;
    localStorage.setItem(KEY, JSON.stringify([{ chainIdentifier, tokenAddress, symbol, name, logoUrl }, ...rest].slice(0, MAX)));
    window.dispatchEvent(new Event(RECENTS_CHANGED_EVENT));
  } catch {
    // Storage blocked — recents are just a convenience.
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(RECENTS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}
