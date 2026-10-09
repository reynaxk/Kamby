'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type MarketFeedEvents, type MarketSummary, slugForIdentifier } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatPercent, formatPrice, priceDirection, cashtag } from '@/lib/format';
import { subscribeToMarketFeeds } from '@/lib/market-feeds';
import { solanaMarketHref } from '@/lib/solana-links';

const TICKER_SIZE = 20;

/** Exported for tests. The ticker's rows: the Trending feed's highest 24h volume. */
export function topByVolume(markets: MarketSummary[], size = TICKER_SIZE): MarketSummary[] {
  return markets
    .filter((m) => m.volume24hUsd !== null)
    .slice()
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, size);
}

/**
 * A persistent, app-wide scrolling price ticker — rendered once from the root layout
 * (app/layout.tsx), not per-page, since it's meant to stay visible everywhere the same way
 * a real trading floor ticker never turns off. Fed by the live market stream (lib/market-
 * feeds.ts — the same single connection Discover's token rail uses, no polling): the
 * Trending snapshot arrives the moment it connects and again whenever it changes, and the
 * ticker shows its highest-volume rows.
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
  const pathname = usePathname();
  const [markets, setMarkets] = useState<MarketSummary[]>([]);

  useEffect(
    () =>
      subscribeToMarketFeeds(
        (type, data) => {
          if (type === 'trending') setMarkets(topByVolume((data as MarketFeedEvents['trending']).markets));
        },
        // A dead stream just leaves the ticker as it was — never worth surfacing app-wide.
        () => {},
      ),
    [],
  );

  if (markets.length === 0) return null;

  const items = [...markets, ...markets];

  // Not on the landing page — new visitors don't see coins before signing in (2026-10-04).
  if (pathname === '/') return null;

  return (
    <div className="kamby-void fixed inset-x-0 bottom-0 z-40 hidden h-8 overflow-hidden border-t border-line bg-surface md:block">
      <div className="flex h-full w-max animate-marquee items-center hover:[animation-play-state:paused]">
        {items.map((market, i) => {
          const direction = priceDirection(market.priceChange24hPct);
          const chainSlug = slugForIdentifier(market.chainIdentifier);
          const href = chainSlug
            ? `/market/${chainSlug}/${market.tokenAddress}`
            : market.chainIdentifier === 'solana'
              ? solanaMarketHref(market.tokenAddress)
              : null;
          const ticker = (
            <>
              <span className="font-semibold text-ink-900">{cashtag(market.symbol ?? '?')}</span>
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
            </>
          );
          const className =
            'flex shrink-0 items-center gap-1.5 border-r border-line/60 px-3 font-mono text-xs transition-colors hover:bg-surface-raised';
          return href ? (
            <Link
              key={`${market.chainIdentifier}:${market.tokenAddress}:${i}`}
              href={href}
              className={className}
            >
              {ticker}
            </Link>
          ) : (
            <span
              key={`${market.chainIdentifier}:${market.tokenAddress}:${i}`}
              title="This market is visible for discovery but is not tradeable here yet"
              className={`${className} cursor-not-allowed opacity-70`}
            >
              {ticker}
            </span>
          );
        })}
      </div>
    </div>
  );
}
