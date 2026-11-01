'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { newsTokenKey, type NewsItem } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchNews, subscribeToNews } from '@/lib/news-client';
import { useNarratives } from '@/lib/narratives-client';
import { NewsCard } from './NewsCard';

interface Props {
  /** With `tokenAddress`: only this coin's news. */
  chainIdentifier?: string;
  tokenAddress?: string;
  symbol?: string | null;
  limit?: number;
  /** No "load more" — a fixed short list (a coin page card). */
  fixed?: boolean;
  compact?: boolean;
  /** Render nothing rather than an empty state when there's no news. */
  hideWhenEmpty?: boolean;
  /** Bigger cards (the News page). */
  large?: boolean;
  /** Cards in a grid — up to four to a row (the News page). */
  grid?: boolean;
  className?: string;
}

/** Headlines newest first, new ones slotting in live at the top. */
export function NewsFeed({ chainIdentifier, tokenAddress, symbol, limit = 20, fixed = false, compact = false, hideWhenEmpty = false, large = false, grid = false, className }: Props) {
  const t = useTranslations('news');
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const coinKey = chainIdentifier && tokenAddress ? newsTokenKey(chainIdentifier, tokenAddress) : null;

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setFailed(false);
    fetchNews({ chainIdentifier, tokenAddress, limit }, controller.signal)
      .then((page) => {
        setItems(page.items);
        setNextBefore(page.nextBefore);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    const unsubscribe = subscribeToNews((item) => {
      if (coinKey && !item.tokens.some((tk) => newsTokenKey(tk.chainIdentifier, tk.tokenAddress) === coinKey)) return;
      setItems((prev) => (prev && !prev.some((p) => p.id === item.id) ? [item, ...prev].slice(0, fixed ? limit : undefined) : prev));
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [chainIdentifier, tokenAddress, coinKey, limit, fixed]);

  // Tagged coins' 24h moves on the big cards, from the one shared narratives stream.
  const narratives = useNarratives();
  const moves = useMemo(() => {
    const out = new Map<string, number>();
    if (!large || !narratives) return out;
    for (const n of narratives.narratives) for (const tk of n.tokens) if (typeof tk.change24hPct === 'number') out.set(newsTokenKey(tk.chainIdentifier, tk.tokenAddress), tk.change24hPct);
    return out;
  }, [large, narratives]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNews({ chainIdentifier, tokenAddress, before: nextBefore, limit });
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.id));
        return [...(prev ?? []), ...page.items.filter((p) => !seen.has(p.id))];
      });
      setNextBefore(page.nextBefore);
    } catch {
      // The next scroll tries again.
    } finally {
      setLoadingMore(false);
    }
  }, [chainIdentifier, tokenAddress, nextBefore, limit, loadingMore]);

  // Endless list (2026-11-01): older headlines load as the bottom comes near — no button.
  const loaded = items !== null;
  const sentinel = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef(loadMore);
  loadRef.current = loadMore;
  useEffect(() => {
    const el = sentinel.current;
    if (fixed || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadRef.current(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [fixed, nextBefore, loaded]);

  if (items === null && !failed) {
    return (
      <div className={cn(grid ? 'grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2', className)} aria-busy>
        {Array.from({ length: grid ? 8 : Math.min(limit, 4) }).map((_, i) => (
          <Skeleton key={i} className={cn('w-full rounded-xl', grid ? 'h-56' : 'h-24')} />
        ))}
      </div>
    );
  }
  if (failed) return hideWhenEmpty ? null : <p className={cn('py-6 text-center font-body text-sm text-ink-400', className)}>{t('failed')}</p>;
  if (!items || items.length === 0) {
    if (hideWhenEmpty) return null;
    return <p className={cn('py-6 text-center font-body text-sm text-ink-400', className)}>{symbol ? t('emptyCoin', { symbol: `$${symbol}` }) : t('empty')}</p>;
  }

  return (
    <div className={cn('flex flex-col', large ? 'gap-3' : 'gap-2', className)}>
      <div className={cn(grid ? 'grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col', !grid && (large ? 'gap-3' : 'gap-2'))}>
        {items.map((item) => (
          <NewsCard key={item.id} item={item} compact={compact} large={large} moves={large ? moves : undefined} className={grid ? 'h-full' : undefined} />
        ))}
      </div>
      {!fixed && nextBefore && (
        <div ref={sentinel} aria-hidden className={cn(grid && 'grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4')}>
          {loadingMore && <Skeleton className={cn('w-full rounded-xl', grid ? 'h-56' : 'h-24')} />}
        </div>
      )}
    </div>
  );
}
