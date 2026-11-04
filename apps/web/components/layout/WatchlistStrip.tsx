'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Star, X } from 'lucide-react';
import type { CryptoPrice, MarketFeedEvents } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatPercent } from '@/lib/format';
import { subscribeToMarketFeeds } from '@/lib/market-feeds';
import { closeCoinTab, useCoinTabs } from '@/lib/coin-tabs';

/** The big coins on the right of the strip (owner 2026-11-03), live from the price stream. */
const MAJORS = ['BTC', 'ETH', 'SOL', 'BNB'] as const;

/**
 * The thin row under the top menu (Kamby Prime, 2026-11-04): the coins you opened as tabs,
 * like a browser — one click back to any of them, ✕ to close — and BTC/ETH/SOL/BNB live on
 * the right. Computers only. (Was the starred-coins strip; starred coins live in
 * Explore → Watchlist, one click away from the star.)
 */
export function WatchlistStrip() {
  const pathname = usePathname() ?? '/';
  // Tabs only exist after mount (localStorage), so reading the query here never mismatches SSR.
  const here = pathname + (typeof window === 'undefined' ? '' : window.location.search);
  const tabs = useCoinTabs();
  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  useEffect(
    () =>
      typeof EventSource === 'undefined'
        ? undefined
        : subscribeToMarketFeeds(
            (type, data) => type === 'crypto' && setPrices((data as MarketFeedEvents['crypto']).prices),
            () => {},
          ),
    [],
  );

  const majors = MAJORS.map((symbol) => prices.find((p) => p.symbol === symbol)).filter((p): p is CryptoPrice => Boolean(p));
  return (
    <div className="hidden h-9 items-center gap-0.5 border-b border-line bg-[#08090B] px-3 lg:flex">
      <Link href="/explore?tab=watchlist" aria-label="Watchlist" className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-surface-raised hover:text-[#F2C46D]">
        <Star className="h-3.5 w-3.5" aria-hidden />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const active = here === tab.href || (pathname !== '/solana' && pathname === tab.href.split('?')[0]);
          return (
            <span
              key={`${tab.chainIdentifier}:${tab.address}`}
              className={cn('group flex h-[26px] shrink-0 items-center rounded-md pl-2 pr-1 text-[0.78rem]', active ? 'bg-surface-raised text-ink-900' : 'text-ink-600 hover:bg-surface')}
            >
              <Link href={tab.href} className="flex items-center gap-1.5 font-medium">
                <TokenAvatar src={tab.logoUrl} seed={tab.address} label={tab.symbol} className="!rounded h-4 w-4 text-[0.45rem]" />
                {tab.symbol ?? tab.address.slice(0, 4)}
              </Link>
              <button
                type="button"
                aria-label={`Close ${tab.symbol ?? ''}`}
                onClick={() => closeCoinTab(tab)}
                className="ml-1 flex h-4 w-4 items-center justify-center rounded text-ink-400 opacity-60 hover:bg-white/10 hover:text-ink-900 group-hover:opacity-100"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
      {majors.map((p) => (
        <span key={p.symbol} className="flex h-6 shrink-0 items-center gap-1.5 px-2 font-mono text-[0.7rem] tabular-nums">
          <span className="text-ink-400">{p.symbol}</span>
          <span className="text-ink-900">{p.priceUsd >= 1000 ? Math.round(p.priceUsd).toLocaleString('en-US') : p.priceUsd.toFixed(2)}</span>
          {p.change24hPct !== null && <span className={cn(p.change24hPct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(p.change24hPct)}</span>}
        </span>
      ))}
    </div>
  );
}
