'use client';

import { useEffect, useState } from 'react';
import { slugForIdentifier, CHAIN_REGISTRY, type MarketSummary } from '@kamby/domain';
import { fetchLivePrice, livePriceStreamUrl, type ChartSource } from './chart-data';

const REFRESH_MS = 1_500;

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
  stream: EventSource | null;
}
const subscriptions = new Map<string, Subscription>();

/** The last 30 minutes of live prices per coin (one per 2s tick), kept while browsing so the
 *  10s candles open with recent history instead of an empty chart. */
const TICK_HISTORY_MAX = 900;
const tickHistory = new Map<string, { t: number; p: number }[]>();

/** This coin's recorded live prices (unix seconds, oldest first). */
export function recentTicks(source: ChartSource): readonly { t: number; p: number }[] {
  return tickHistory.get(keyFor(source)) ?? [];
}

function keyFor(source: ChartSource): string {
  return source.kind === 'solana' ? `sol:${source.mint}` : `${source.chainId}:${source.address.toLowerCase()}`;
}

/** Calls `onPrice` with each new live price (immediately with the last one, if known). Returns an unsubscribe. */
export function subscribeLivePrice(source: ChartSource, onPrice: (price: number) => void, onError?: () => void): () => void {
  const key = keyFor(source);
  let entry = subscriptions.get(key);
  if (!entry) {
    const created: Subscription = { listeners: new Set(), errors: new Set(), timer: null, last: null, stream: null };
    subscriptions.set(key, created);
    const deliver = (priceUsd: number) => {
      created.last = priceUsd;
      const ticks = tickHistory.get(key) ?? [];
      ticks.push({ t: Math.floor(Date.now() / 1000), p: priceUsd });
      if (ticks.length > TICK_HISTORY_MAX) ticks.splice(0, ticks.length - TICK_HISTORY_MAX);
      tickHistory.set(key, ticks);
      created.listeners.forEach((l) => l(priceUsd));
    };
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const live = await fetchLivePrice(source);
          if (live) deliver(live.priceUsd);
        } catch {
          created.errors.forEach((e) => e());
        }
      }
      if (subscriptions.get(key) === created) created.timer = setTimeout(() => void tick(), REFRESH_MS);
    };
    // Pushed prices first (2026-10-07, up to 1.5s fresher); polling only if the stream can't
    // open or is closed by the server (an API redeploy, an unlisted coin). The browser itself
    // retries brief drops.
    if (typeof EventSource !== 'undefined') {
      const es = new EventSource(livePriceStreamUrl(source));
      created.stream = es;
      es.addEventListener('price', (event) => {
        try {
          const live = JSON.parse((event as MessageEvent<string>).data) as { priceUsd?: number };
          if (typeof live.priceUsd === 'number' && live.priceUsd > 0) deliver(live.priceUsd);
        } catch {
          // A malformed frame is skipped.
        }
      });
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED || subscriptions.get(key) !== created) return;
        created.stream = null;
        void tick();
      };
    } else {
      void tick();
    }
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
      current.stream?.close();
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
