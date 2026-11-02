'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { WatchedToken } from '@kamby/domain';
import { usePrivy } from '@privy-io/react-auth';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatPercent } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { fetchWatchlist, hasStoredSession } from '@/lib/watchlist-client';

const REFRESH_MS = 60_000;

/**
 * Your starred coins in one thin row under the top menu (2026-11-02, like GMGN's): each with
 * its 24h move, one click to open. Computers only, signed in, and only when you watch something.
 */
export function WatchlistStrip() {
  const { authenticated } = usePrivy();
  const [items, setItems] = useState<WatchedToken[]>([]);

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

  if (!authenticated || items.length === 0) return null;
  return (
    <div className="hidden h-8 items-center gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] lg:flex">
      <Link href="/explore?tab=watchlist" aria-label="Watchlist" className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#FBBF24] hover:bg-surface">
        <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
      </Link>
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
