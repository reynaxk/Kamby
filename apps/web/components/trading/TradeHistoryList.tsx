'use client';

import type { TradeTransactionDto } from '@kamby/domain';
import { Surface, cn } from '@kamby/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { formatDateTime } from '@/lib/format';
import { hasStoredSession } from '@/lib/session-client';
import { getTradeHistory } from '@/lib/trading-client';
import { StatusPill } from './StatusPill';
import { useTranslations } from 'next-intl';

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * Strictly the caller's own trades — see docs/TRADING.md#authorization. There is no way to
 * view anyone else's trade history from this UI, matching /trade/history's server-side
 * scoping (no ?userId= override exists on either side).
 */
export function TradeHistoryList() {
  const tU = useTranslations('ui');
  const [state, setState] = useState<State>('loading');
  const [items, setItems] = useState<TradeTransactionDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    getTradeHistory({ limit: 20 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getTradeHistory({ cursor, limit: 20 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (state === 'no-session') {
    return <EmptyState title={tU('noTradesYet_ceb3')} detail="Connect a wallet and make your first trade to see it here." />;
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (state === 'error') {
    return <EmptyState title={tU('couldnTLoadYourTrade_88d8')} detail="Try again in a moment." />;
  }
  if (items.length === 0) {
    return <EmptyState title={tU('noTradesYet_ceb3')} detail="Your BUY/SELL trades will show up here once you make one." />;
  }

  return (
    <div className="flex flex-col gap-3 max-md:gap-0">
      {items.map((trade) => (
        <Link key={trade.id} href={`/trades/${trade.id}`}>
          <Surface className="flex items-center justify-between gap-3 p-4 hover:border-accent max-md:rounded-none max-md:border-0 max-md:border-b max-md:border-white/5 max-md:bg-transparent max-md:px-0 max-md:py-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* Phones: a round buy/sell mark, like a bank app's transaction list. */}
              <span
                aria-hidden
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-base font-bold md:hidden',
                  trade.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
                )}
              >
                {trade.side === 'BUY' ? '↑' : '↓'}
              </span>
              <div className="min-w-0 md:flex md:items-center md:gap-3">
                <span className={cn('font-mono text-xs font-semibold uppercase tracking-wide max-md:hidden', trade.side === 'BUY' ? 'text-up' : 'text-down')}>
                  {trade.side === 'BUY' ? tU('bought_fe5a') : tU('sold_d85a')}
                </span>
                <span className="block truncate font-display text-sm font-semibold text-ink-900 max-md:text-base">
                  {trade.expectedOutputAmountFormatted} {trade.token.symbol ?? ''}
                </span>
                <time className="block font-mono text-xs text-ink-400 md:hidden">{formatDateTime(trade.submittedAt)}</time>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <time className="font-mono text-xs text-ink-400 max-md:hidden">{formatDateTime(trade.submittedAt)}</time>
              <StatusPill status={trade.status} />
            </div>
          </Surface>
        </Link>
      ))}
      {cursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="rounded-lg border border-line py-2 font-body text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50"
        >
          {loadingMore ? tU('loading_5f02') : tU('loadMore_f6b5')}
        </button>
      )}
    </div>
  );
}
