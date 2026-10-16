'use client';

/**
 * Coins you looked up, newest first (2026-10-10, like fomo's "Recents"; 2026-10-16 every coin
 * you open counts, not only search taps, and the price when you looked is kept so Search can
 * show how far it has moved since) — kept in this browser only (a convenience, not account
 * data), at most 10.
 */
export interface RecentSearch {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  /** The price when you last looked at it — older entries may not have one. */
  priceUsd?: number | null;
  viewedAt?: number;
}

const KEY = 'kamby:recent-searches';
const MAX = 10;
export const RECENTS_CHANGED_EVENT = 'kamby:recents-changed';

export function readRecentSearches(): RecentSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as RecentSearch[]).filter((r) => r && typeof r.tokenAddress === 'string') : [];
  } catch {
    return [];
  }
}

function write(items: RecentSearch[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
    window.dispatchEvent(new Event(RECENTS_CHANGED_EVENT));
  } catch {
    // Storage blocked — recents are just a convenience.
  }
}

const same = (a: Pick<RecentSearch, 'chainIdentifier' | 'tokenAddress'>, b: Pick<RecentSearch, 'chainIdentifier' | 'tokenAddress'>) =>
  a.chainIdentifier === b.chainIdentifier && a.tokenAddress === b.tokenAddress;

export function saveRecentSearch(item: RecentSearch): void {
  const { chainIdentifier, tokenAddress, symbol, name, logoUrl } = item;
  const priceUsd = typeof item.priceUsd === 'number' && item.priceUsd > 0 ? item.priceUsd : null;
  write([{ chainIdentifier, tokenAddress, symbol, name, logoUrl, priceUsd, viewedAt: Date.now() }, ...readRecentSearches().filter((r) => !same(r, item))]);
}

export function removeRecentSearch(item: Pick<RecentSearch, 'chainIdentifier' | 'tokenAddress'>): void {
  write(readRecentSearches().filter((r) => !same(r, item)));
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(RECENTS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}
