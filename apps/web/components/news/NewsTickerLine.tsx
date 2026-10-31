'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { newsTokenKey, type NewsItem } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime } from '@/lib/format';
import { fetchNews, subscribeToNews } from '@/lib/news-client';
import { NewsSourceMark } from './NewsCard';
import { useNow } from './useNow';

/** A coin's own headline counts for a day; a general one only while it's still breaking. */
const COIN_FRESH_MS = 24 * 60 * 60_000;
const BREAKING_FRESH_MS = 3 * 60 * 60_000;

/** Exported for tests. The headline to show: this coin's newest if recent, else breaking news. */
export function pickTickerItem(coinItems: NewsItem[], allItems: NewsItem[], now: number): NewsItem | null {
  const coin = coinItems[0];
  if (coin && now - Date.parse(coin.publishedAt) <= COIN_FRESH_MS) return coin;
  const latest = allItems[0];
  if (latest && now - Date.parse(latest.publishedAt) <= BREAKING_FRESH_MS) return latest;
  return null;
}

/**
 * One slim line on a coin's page: the latest news about that coin, or breaking crypto news when
 * there's none — updated live. Hidden when there's nothing recent.
 */
export function NewsTickerLine({ chainIdentifier, tokenAddress, className }: { chainIdentifier: string; tokenAddress: string; className?: string }) {
  const t = useTranslations('news');
  const now = useNow();
  const [coinItems, setCoinItems] = useState<NewsItem[]>([]);
  const [allItems, setAllItems] = useState<NewsItem[]>([]);
  const coinKey = newsTokenKey(chainIdentifier, tokenAddress);

  useEffect(() => {
    const controller = new AbortController();
    setCoinItems([]);
    setAllItems([]);
    void Promise.all([
      fetchNews({ chainIdentifier, tokenAddress, limit: 1 }, controller.signal).then((p) => setCoinItems(p.items)),
      fetchNews({ limit: 1 }, controller.signal).then((p) => setAllItems(p.items)),
    ]).catch(() => undefined);
    const unsubscribe = subscribeToNews((item) => {
      setAllItems([item]);
      if (item.tokens.some((tk) => newsTokenKey(tk.chainIdentifier, tk.tokenAddress) === coinKey)) setCoinItems([item]);
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [chainIdentifier, tokenAddress, coinKey]);

  const item = pickTickerItem(coinItems, allItems, now.getTime());
  if (!item) return null;
  const aboutCoin = coinItems[0]?.id === item.id;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn('group flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 transition-colors hover:border-white/15', className)}
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 font-display text-[0.65rem] font-bold uppercase tracking-wide text-accent">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        {aboutCoin ? t('title') : t('breaking')}
      </span>
      <NewsSourceMark sourceId={item.sourceId} className="hidden shrink-0 sm:inline-flex" />
      <span className="min-w-0 flex-1 truncate font-body text-sm font-medium text-ink-900 group-hover:text-accent">{item.title}</span>
      <time dateTime={item.publishedAt} className="shrink-0 font-body text-xs text-ink-400">
        {formatRelativeTime(item.publishedAt, now)}
      </time>
    </a>
  );
}
