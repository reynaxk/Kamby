'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { CryptoPrice, MarketFeedEvents, WatchedToken } from '@kamby/domain';
import { usePrivy } from '@privy-io/react-auth';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatPercent } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { fetchWatchlist, hasStoredSession } from '@/lib/watchlist-client';
import { subscribeToMarketFeeds } from '@/lib/market-feeds';

/** The big coins first on the strip (owner 2026-11-03), live from the same price stream as the bottom bar. */
const MAJORS = ['BTC', 'ETH', 'SOL', 'BNB'] as const;
const MAJOR_DOT: Record<(typeof MAJORS)[number], string> = { BTC: '#F7931A', ETH: '#8EA2FF', SOL: '#14F195', BNB: '#F3BA2F' };

const REFRESH_MS = 60_000;

/**
 * Your starred coins in one thin row under the top menu (2026-11-02, like GMGN's): each with
 * its 24h move, one click to open. Computers only, signed in, and only when you watch something.
 */
export function WatchlistStrip() {
  const { authenticated } = usePrivy();
  const [items, setItems] = useState<WatchedToken[]>([]);
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

  useEffect(() => {
    if (!authenticated || !hasStoredSession()) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      fetchWatchlist({ limit: 20 })
        .then((page) => !cancelled && setItems(page.items))
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authenticated]);

  const majors = MAJORS.map((symbol) => prices.find((p) => p.symbol === symbol)).filter((p): p is CryptoPrice => Boolean(p));
  if (majors.length === 0 && (!authenticated || items.length === 0)) return null;
  return (
    <div className="hidden h-8 items-center gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] lg:flex">
      <Link href="/explore?tab=watchlist" aria-label="Watchlist" className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#FBBF24] hover:bg-surface">
        <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
      </Link>
      {majors.map((p) => (
        <span key={p.symbol} className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[0.72rem] tabular-nums">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: MAJOR_DOT[p.symbol as (typeof MAJORS)[number]] }} aria-hidden />
          <span className="font-bold text-ink-900">{p.symbol}</span>
          <span className="text-ink-600">${p.priceUsd >= 1000 ? Math.round(p.priceUsd).toLocaleString('en-US') : p.priceUsd.toFixed(2)}</span>
          {p.change24hPct !== null && <span className={cn(p.change24hPct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(p.change24hPct)}</span>}
        </span>
      ))}
      {majors.length > 0 && items.length > 0 && <span className="mx-1 h-3.5 w-px shrink-0 bg-white/10" aria-hidden />}
      {items.map((item) => {
        const pct = item.priceChange24hPct;
        const href = marketHref(item.chainIdentifier, item.tokenAddress);
        if (!href) return null;
        return (
          <Link
            key={`${item.chainIdentifier}:${item.tokenAddress}`}
            href={href}
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[0.72rem] tabular-nums hover:bg-surface"
          >
            <TokenAvatar src={item.logoUrl} seed={item.tokenAddress} label={item.symbol ?? item.name} className="h-4 w-4 text-[0.45rem]" />
            <span className="font-bold text-ink-900">{item.symbol ?? item.tokenAddress.slice(0, 4)}</span>
            {pct !== null && <span className={cn(pct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(pct)}</span>}
          </Link>
        );
      })}
    </div>
  );
}
