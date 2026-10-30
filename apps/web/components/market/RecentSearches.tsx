'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { PriceText } from './PriceText';
import { fetchLivePrice } from '@/lib/chart-data';
import { liveSourceFor } from '@/lib/use-live-price';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatPercent } from '@/lib/format';
import { clearRecentSearches, readRecentSearches, RECENTS_CHANGED_EVENT, removeRecentSearch, type RecentSearch } from '@/lib/recent-searches';

const keyOf = (r: Pick<RecentSearch, 'chainIdentifier' | 'tokenAddress'>) => `${r.chainIdentifier}:${r.tokenAddress}`;

/**
 * The Search screen's history (2026-10-16 redesign, owner: "make it aesthetic too"): the coins
 * you looked up as small midnight cards — today's price, and how far it has moved since you
 * looked (the price is kept when you open a coin). One price request per card when Search
 * opens, no live streams.
 */
export function RecentSearches() {
  const t = useTranslations('labels');
  const [items, setItems] = useState<RecentSearch[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = () => setItems(readRecentSearches());
    load();
    window.addEventListener(RECENTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(RECENTS_CHANGED_EVENT, load);
  }, []);

  // Today's price for each card, once per opening of Search (not per removal).
  const keys = items.map(keyOf).join('|');
  useEffect(() => {
    let cancelled = false;
    for (const r of items) {
      const source = liveSourceFor(r);
      if (!source || prices[keyOf(r)] !== undefined) continue;
      fetchLivePrice(source)
        .then((live) => {
          if (!cancelled && live && live.priceUsd > 0) setPrices((p) => ({ ...p, [keyOf(r)]: live.priceUsd }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length === 0) return null;
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between px-4 pb-2.5">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          {t('recents')}
        </h2>
        <button type="button" onClick={clearRecentSearches} className="rounded-full px-2.5 py-1 font-body text-xs font-semibold text-ink-400 active:bg-white/10 active:text-ink-900">
          {t('clear')}
        </button>
      </div>
      <ul className="flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((r) => {
          const href = marketHref(r.chainIdentifier, r.tokenAddress);
          if (!href) return null;
          const chain = badgeChainFor(r.chainIdentifier);
          const now = prices[keyOf(r)] ?? null;
          const then = r.priceUsd ?? null;
          const moved = now !== null && then ? ((now - then) / then) * 100 : null;
          const up = (moved ?? 0) >= 0;
          return (
            <li
              key={keyOf(r)}
              className="relative w-[9.25rem] shrink-0 overflow-hidden rounded-2xl border border-white/[0.07]"
              style={{ background: 'linear-gradient(165deg,#0E1430 0%,#090C1A 55%,#020203 100%)' }}
            >
              <Link href={href} className="block p-3 pr-2.5 active:bg-white/[0.03]">
                <span className="flex items-center gap-2">
                  <span className="relative shrink-0">
                    <TokenAvatar src={r.logoUrl} seed={r.tokenAddress} label={r.symbol ?? r.tokenAddress} className="h-9 w-9 text-xs" />
                    {chain && <ChainBadge chain={chain} />}
                  </span>
                  <span className="min-w-0 pr-4">
                    <span className="block truncate font-display text-sm font-bold text-ink-900">{cashtag(r.symbol ?? r.tokenAddress.slice(0, 6))}</span>
                    <span className="block truncate font-body text-[0.65rem] text-ink-400">{r.name ?? ''}</span>
                  </span>
                </span>
                <span className="mt-3 block truncate font-display text-base font-bold tabular-nums text-ink-900">
                  <PriceText value={now ?? then} />
                </span>
                {moved !== null ? (
                  <span className="mt-1.5 block">
                    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-body text-xs font-bold tabular-nums', up ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>
                      {up ? '▲' : '▼'} {formatPercent(moved).replace(/^[+-]/, '')}
                    </span>
                    <span className="mt-1 block truncate font-body text-[0.62rem] text-ink-400">{t('sinceViewed')}</span>
                  </span>
                ) : (
                  <span className="mt-1.5 block h-[2.4rem]" aria-hidden />
                )}
              </Link>
              <button
                type="button"
                aria-label={t('removeRecent')}
                onClick={() => removeRecentSearch(r)}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full text-ink-400 active:bg-white/10 active:text-ink-900"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
