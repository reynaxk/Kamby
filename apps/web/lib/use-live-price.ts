'use client';

import { useEffect, useState } from 'react';
import { slugForIdentifier, CHAIN_REGISTRY, type MarketSummary } from '@kamby/domain';
import { fetchLivePrice, type ChartSource } from './chart-data';

const REFRESH_MS = 2_000;

/** A market's chart/live-price source, or null for chains without one. */
export function liveSourceFor(market: Pick<MarketSummary, 'chainIdentifier' | 'tokenAddress'>): ChartSource | null {
  if (market.chainIdentifier.toLowerCase() === 'solana') return { kind: 'solana', mint: market.tokenAddress };
  const slug = slugForIdentifier(market.chainIdentifier);
  if (slug === 'base' || slug === 'bnb') return { kind: 'evm', chain: slug, address: market.tokenAddress, chainId: CHAIN_REGISTRY[slug].numericId };
  return null;
}

/**
 * One shared 2s poll per coin, however many components show its price (header, Live chart,
 * holders…) — user feedback 2026-10-04: "make the prices move more and respond faster". Each
 * component used to poll on its own (header every 5s, chart every 2s). Pauses while hidden.
 */
interface Subscription {
  listeners: Set<(price: number) => void>;
  errors: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  last: number | null;
}
const subscriptions = new Map<string, Subscription>();

function keyFor(source: ChartSource): string {
  return source.kind === 'solana' ? `sol:${source.mint}` : `${source.chainId}:${source.address.toLowerCase()}`;
}

/** Calls `onPrice` with each new live price (immediately with the last one, if known). Returns an unsubscribe. */
export function subscribeLivePrice(source: ChartSource, onPrice: (price: number) => void, onError?: () => void): () => void {
  const key = keyFor(source);
  let entry = subscriptions.get(key);
  if (!entry) {
    const created: Subscription = { listeners: new Set(), errors: new Set(), timer: null, last: null };
    subscriptions.set(key, created);
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const live = await fetchLivePrice(source);
          if (live) {
            created.last = live.priceUsd;
            created.listeners.forEach((l) => l(live.priceUsd));
          }
        } catch {
          created.errors.forEach((e) => e());
        }
      }
      if (subscriptions.get(key) === created) created.timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    void tick();
    entry = created;
  }
  const current = entry;
  current.listeners.add(onPrice);
  if (onError) current.errors.add(onError);
  if (current.last !== null) onPrice(current.last);
  return () => {
    current.listeners.delete(onPrice);
    if (onError) current.errors.delete(onError);
    if (current.listeners.size === 0) {
      if (current.timer) clearTimeout(current.timer);
      subscriptions.delete(key);
    }
  };
}

/** The coin's latest price from the shared 2s feed (see subscribeLivePrice). null until the first answer. */
export function useLivePrice(source: ChartSource | null): number | null {
  const key = source ? keyFor(source) : null;
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    setPrice(null);
    if (!source) return;
    return subscribeLivePrice(source, setPrice);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return price;
}
