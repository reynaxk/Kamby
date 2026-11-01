'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MarketFeedSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { WatchlistView } from '@/components/watchlist/WatchlistView';
import { TrendingTable } from './TrendingTable';

type Tab = 'trending' | 'watchlist';

/** Explore's two tabs (2026-11-01): Trending (every chain, GMGN-style table) and your Watchlist. */
export function ExploreView({ initial, initialTab }: { initial: MarketFeedSnapshot; initialTab: Tab }) {
  const t = useTranslations('explorePage');
  const [tab, setTab] = useState<Tab>(initialTab);
  const choose = (next: Tab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'watchlist') url.searchParams.set('tab', 'watchlist');
      else url.searchParams.delete('tab');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // Cosmetic only.
    }
  };
  return (
    <>
      <div role="tablist" className="mb-3 flex gap-6 border-b border-white/[0.07] px-4 md:px-0">
        {(['trending', 'watchlist'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => choose(id)}
            className={cn('relative pb-2.5 font-display text-base font-bold transition-colors', tab === id ? 'text-ink-900' : 'text-ink-400 hover:text-ink-600')}
          >
            {t(id)}
            {tab === id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {tab === 'trending' ? (
        <TrendingTable initial={initial} />
      ) : (
        <div className="mx-auto max-w-3xl px-4 md:px-0">
          <WatchlistView />
        </div>
      )}
    </>
  );
}
