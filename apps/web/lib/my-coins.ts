'use client';

import { useEffect, useState } from 'react';
import { newsTokenKey } from '@kamby/domain';
import { fetchMyPositions } from './discovery-client';
import { fetchWatchlist, hasStoredSession } from './watchlist-client';

/**
 * The coins this person holds and watches, as newsTokenKey()s (2026-10-31) — one fetch shared by
 * everything that marks "You hold" (news cards, the news alerts), refreshed every few minutes
 * while something is listening. Empty without a session; never creates one.
 */
export interface MyCoins {
  held: ReadonlySet<string>;
  watched: ReadonlySet<string>;
}

const EMPTY: MyCoins = { held: new Set(), watched: new Set() };
const REFRESH_MS = 5 * 60_000;
const listeners = new Set<(coins: MyCoins) => void>();
let current: MyCoins = EMPTY;
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  if (!hasStoredSession()) return;
  const [positions, watchlist] = await Promise.all([fetchMyPositions().catch(() => null), fetchWatchlist({ limit: 50 }).catch(() => null)]);
  current = {
    held: positions
      ? new Set(positions.filter((p) => p.quantity > 0).map((p) => newsTokenKey(p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : 'eip155:8453'), p.tokenAddress)))
      : current.held,
    watched: watchlist ? new Set(watchlist.items.map((w) => newsTokenKey(w.chainIdentifier, w.tokenAddress))) : current.watched,
  };
  loadedAt = Date.now();
  for (const listener of listeners) listener(current);
}

function refresh(): void {
  if (inFlight) return;
  inFlight = load().finally(() => {
    inFlight = null;
  });
}

/** Subscribe to my coins; the first listener starts the refresh, the last stops it. */
export function subscribeMyCoins(listener: (coins: MyCoins) => void): () => void {
  listeners.add(listener);
  listener(current);
  if (Date.now() - loadedAt > REFRESH_MS) refresh();
  if (!timer) timer = setInterval(refresh, REFRESH_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useMyCoins(): MyCoins {
  const [coins, setCoins] = useState<MyCoins>(current);
  useEffect(() => subscribeMyCoins(setCoins), []);
  return coins;
}
