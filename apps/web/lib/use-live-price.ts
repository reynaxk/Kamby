'use client';

import { useEffect, useState } from 'react';
import { slugForIdentifier, CHAIN_REGISTRY, type MarketSummary } from '@kamby/domain';
import { fetchLivePrice, type ChartSource } from './chart-data';

const REFRESH_MS = 5_000;

/** A market's chart/live-price source, or null for chains without one. */
export function liveSourceFor(market: Pick<MarketSummary, 'chainIdentifier' | 'tokenAddress'>): ChartSource | null {
  if (market.chainIdentifier.toLowerCase() === 'solana') return { kind: 'solana', mint: market.tokenAddress };
  const slug = slugForIdentifier(market.chainIdentifier);
  if (slug === 'base' || slug === 'bnb') return { kind: 'evm', chain: slug, address: market.tokenAddress, chainId: CHAIN_REGISTRY[slug].numericId };
  return null;
}

/**
 * The coin's latest price, refreshed every 5s while the tab is visible (user feedback
 * 2026-10-03: "some coins I clicked don't move the prices" — the header showed the price from
 * when the page or selection loaded). Uses the shared live-price feed (one batched DexScreener
 * lookup server-side for every coin anyone is watching). null until the first answer.
 */
export function useLivePrice(source: ChartSource | null): number | null {
  const key = source ? (source.kind === 'solana' ? `sol:${source.mint}` : `${source.chainId}:${source.address}`) : null;
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    setPrice(null);
    if (!source) return;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const live = await fetchLivePrice(source);
        if (!cancelled && live) setPrice(live.priceUsd);
      } catch {
        // keep the last price
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return price;
}
