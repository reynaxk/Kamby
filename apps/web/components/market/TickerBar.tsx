'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DEFAULT_CHAIN_SLUG, type MarketSummary, slugForIdentifier } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatPercent, formatPrice, priceDirection } from '@/lib/format';
import { fetchDiscoverMarkets } from '@/lib/market-client';

const POLL_INTERVAL_MS = 20_000;

function marketHref(market: MarketSummary): string {
  return `/market/${slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG}/${market.tokenAddress}`;
}

/**
 * A persistent, app-wide scrolling price ticker — rendered once from the root layout
 * (app/layout.tsx), not per-page, since it's meant to stay visible everywhere the same way
 * a real trading floor ticker never turns off. Client-fetched (lib/market-client.ts's
 * fetchDiscoverMarkets) rather than server-seeded because the root layout wraps every page,
 * most of which don't otherwise fetch market data at all — polling from the browser keeps
 * this self-contained instead of forcing every route to plumb ticker data through.
 *
 * Deliberately its own `kamby-void` scope (see globals.css) regardless of the page underneath
 * it — most of the product still runs the original light/dark palette (the Void rollout has
 * stayed deliberately incremental per-page), but a ticker that changed color scheme with
 * whatever page it happened to float over would look broken, not themed.
 *
 * The scroll track renders the list twice back to back and animates exactly -50% (see the
 * `marquee` keyframe in packages/config/tailwind-preset.cjs) — the loop point is invisible
 * since the second copy is already sitting where the first one started. Pauses on hover
 * (`hover:[animation-play-state:paused]`) so a symbol can actually be read/clicked.
 */
export function TickerBar() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchDiscoverMarkets({ sort: 'volume', limit: 20 })
        .then((result) => {
          if (!cancelled) setMarkets(result);
        })
        .catch(() => {
          // A dead ticker just stays empty — never worth degrading the rest of the app for.
        });
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (markets.length === 0) return null;

  const items = [...markets, ...markets];

  return (
    <div className="kamby-void fixed inset-x-0 bottom-0 z-40 h-8 overflow-hidden border-t border-line bg-surface">
      <div className="flex h-full w-max animate-marquee items-center hover:[animation-play-state:paused]">
        {items.map((market, i) => {
          const direction = priceDirection(market.priceChange24hPct);
          return (
            <Link
              key={`${market.chainIdentifier}:${market.tokenAddress}:${i}`}
              href={marketHref(market)}
              className="flex shrink-0 items-center gap-1.5 border-r border-line/60 px-3 font-mono text-xs transition-colors hover:bg-surface-raised"
            >
              <span className="font-semibold text-ink-900">${market.symbol ?? '?'}</span>
              <span className="text-ink-400">{formatPrice(market.priceUsd)}</span>
              <span className={cn(direction === 'up' && 'text-up', direction === 'down' && 'text-down', direction === 'flat' && 'text-ink-400')}>
                {formatPercent(market.priceChange24hPct)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
