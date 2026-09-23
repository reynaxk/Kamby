'use client';

import { useEffect, useState } from 'react';
import type { MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatPercent, formatPrice, priceDirection } from '@/lib/format';
import { fetchDiscoverMarkets } from '@/lib/market-client';

/**
 * Real, live token prices inline in the hero — not a static illustration. `TickerBar`
 * already proves this data works and polls continuously from the root layout; this is a
 * smaller, one-time-fetch sibling scoped to the hero itself, so the welcome page's first
 * impression isn't *only* a headline, and isn't relying on the visitor's eye finding the
 * fixed bar at the very bottom of the screen. A quiet failure (or a still-empty list) just
 * renders nothing — this is a nice-to-have proof point, never something worth an error state
 * or a loading skeleton on a marketing page.
 */
export function WelcomeLivePrices() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchDiscoverMarkets({ sort: 'volume', limit: 4 })
      .then((result) => {
        if (!cancelled) setMarkets(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (markets.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {markets.map((market) => {
        const direction = priceDirection(market.priceChange24hPct);
        return (
          <div
            key={`${market.chainIdentifier}:${market.tokenAddress}`}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-3 py-1 font-mono text-xs"
          >
            <span className="font-semibold text-ink-900">${market.symbol ?? '?'}</span>
            <span className="text-ink-400">{formatPrice(market.priceUsd)}</span>
            <span
              className={cn(
                direction === 'up' && 'text-up',
                direction === 'down' && 'text-down',
                direction === 'flat' && 'text-ink-400',
              )}
            >
              {formatPercent(market.priceChange24hPct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
