'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { newsTokenKey, type NewsItem } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchNews, subscribeToNews } from '@/lib/news-client';
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
  className?: string;
}

/** Headlines newest first, new ones slotting in live at the top. */
export function NewsFeed({ chainIdentifier, tokenAddress, symbol, limit = 20, fixed = false, compact = false, hideWhenEmpty = false, className }: Props) {
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

  const loadMore = useCallback(async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNews({ chainIdentifier, tokenAddress, before: nextBefore, limit });
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.id));
        return [...(prev ?? []), ...page.items.filter((p) => !seen.has(p.id))];
      });
      setNextBefore(page.nextBefore);
    } catch {
      // The button stays; tapping again retries.
    } finally {
      setLoadingMore(false);
    }
  }, [chainIdentifier, tokenAddress, nextBefore, limit]);

  if (items === null && !failed) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-busy>
        {Array.from({ length: Math.min(limit, 4) }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
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
    <div className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => (
        <NewsCard key={item.id} item={item} compact={compact} />
      ))}
      {!fixed && nextBefore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-1 rounded-xl border border-line py-2.5 font-body text-sm font-semibold text-ink-700 transition-colors hover:border-white/20 hover:text-ink-900 disabled:opacity-60"
        >
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
