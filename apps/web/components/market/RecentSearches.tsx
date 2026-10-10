'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { marketHref } from '@/lib/solana-links';
import { cashtag } from '@/lib/format';
import { clearRecentSearches, readRecentSearches, RECENTS_CHANGED_EVENT, type RecentSearch } from '@/lib/recent-searches';

/** The Search screen's "Recent" row — coins you opened from search, as tappable chips. */
export function RecentSearches() {
  const t = useTranslations('labels');
  const [items, setItems] = useState<RecentSearch[]>([]);

  useEffect(() => {
    const load = () => setItems(readRecentSearches());
    load();
    window.addEventListener(RECENTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(RECENTS_CHANGED_EVENT, load);
  }, []);

  if (items.length === 0) return null;
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between px-4 pb-2">
        <h2 className="font-display text-sm font-semibold text-ink-400">{t('recents')}</h2>
        <button type="button" onClick={clearRecentSearches} className="font-body text-xs font-semibold text-ink-400 active:text-ink-900">
          {t('clear')}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-1">
        {items.map((r) => {
          const href = marketHref(r.chainIdentifier, r.tokenAddress);
          const chain = badgeChainFor(r.chainIdentifier);
          if (!href) return null;
          return (
            <Link
              key={`${r.chainIdentifier}:${r.tokenAddress}`}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-full bg-surface-raised py-1.5 pl-1.5 pr-3 active:bg-white/10"
            >
              <span className="relative">
                <TokenAvatar src={r.logoUrl} seed={r.tokenAddress} label={r.symbol ?? r.tokenAddress} className="h-7 w-7 text-[0.7rem]" />
                {chain && <ChainBadge chain={chain} />}
              </span>
              <span className="font-display text-sm font-semibold text-ink-900">{cashtag(r.symbol ?? r.tokenAddress.slice(0, 6))}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
