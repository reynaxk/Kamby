'use client';

import { useEffect, useState } from 'react';
import type { Candle, SocialActivity, Timeframe } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { DEFAULT_CHART_TIMEFRAMES, InlineTimeframeTabs } from '@/components/discovery/InlineTimeframeTabs';
import { CANDLE_REFRESH_MS, cachedCandles, candleWidthFor, isTickTimeframe, loadCandles, primeCandles, type ChartSource, type ChartTimeframe } from '@/lib/chart-data';
import { KambyChart } from './KambyChart';
import { ChartStyleToggle, useChartStyle } from './ChartStyleToggle';
import { LivePriceChart } from './LivePriceChart';
import { useEntryPrice } from '@/components/trading/PositionChip';
import { useTranslations } from 'next-intl';

const NO_TRADES: SocialActivity[] = [];
/** Short widths refresh while open so the newest candle keeps moving. */

/**
 * A coin's chart card with its own timeframe switching (user feedback 2026-09-30: "the charts
 * are bad looking slow"). Timeframe tabs used to be links that re-rendered the whole page on
 * the server — every market query again, just to change the candle width. Now switching is
 * in place: cached candles show instantly, the current chart stays up while a new width
 * loads, and "Live" swaps in the real-time price line. The URL's ?timeframe= is kept in sync
 * (without a navigation) so a shared link opens on the same width.
 */
export function TokenChartCard({
  source,
  initialTimeframe,
  initialCandles,
  trades = NO_TRADES,
  timeframes = DEFAULT_CHART_TIMEFRAMES,
  className,
}: {
  source: ChartSource;
  initialTimeframe: ChartTimeframe;
  initialCandles: Candle[];
  trades?: SocialActivity[];
  timeframes?: readonly ChartTimeframe[];
  className?: string;
}) {
  const tU = useTranslations('ui');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
  const [chartStyle, setChartStyle] = useChartStyle();
  const entry = useEntryPrice(source.kind === 'solana' ? source.mint : source.address);
  const candleTimeframe: Timeframe = candleWidthFor(timeframe);
  const [candles, setCandles] = useState<Candle[] | null>(initialCandles);
  /** Which width `candles` actually are — the previous chart stays up until the new one lands. */
  const [candlesFor, setCandlesFor] = useState<Timeframe>(candleWidthFor(initialTimeframe));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // The server already fetched the first width — seed the cache so switching back is instant.
  useEffect(() => {
    primeCandles(source, candleWidthFor(initialTimeframe), initialCandles);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const cached = cachedCandles(source, candleTimeframe);
    if (cached) {
      setCandles(cached);
      setCandlesFor(candleTimeframe);
    }
    setFailed(false);
    setLoading(true);
    const load = (force: boolean) =>
      loadCandles(source, candleTimeframe, { force })
        .then((result) => {
          if (cancelled) return;
          setCandles(result);
          setCandlesFor(candleTimeframe);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled && !cached) setFailed(true);
        })
        .finally(() => !cancelled && setLoading(false));
    void load(false);
    const every = isTickTimeframe(timeframe) ? undefined : CANDLE_REFRESH_MS[candleTimeframe];
    const timer = every ? setInterval(() => document.visibilityState === 'visible' && void load(true), every) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [source.kind === 'solana' ? source.mint : `${source.chainId}:${source.address}`, candleTimeframe, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(tf: ChartTimeframe) {
    setTimeframe(tf);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('timeframe', tf);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // Cosmetic only.
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-2', className)}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <InlineTimeframeTabs active={timeframe} onChange={choose} timeframes={timeframes} />
          <ChartStyleToggle value={chartStyle} onChange={setChartStyle} />
        </div>
        {loading && candles !== null && (
          <span aria-live="polite" className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">
            {tU('updating_805a')}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {failed && !candles?.length ? (
          <EmptyState title={tU('couldnTLoadThisChart_3d0a')} detail="Try again in a moment." />
        ) : candles === null ? (
          <Skeleton className="h-full w-full" />
        ) : (isTickTimeframe(timeframe) && candlesFor === '1m') || (!loading && candles.length < 2) ? (
          <LivePriceChart source={source} seedCandles={candles} chartStyle={chartStyle} bucketSeconds={timeframe === 'live' ? 60 : 10} entryPrice={entry?.price} />
        ) : (
          <KambyChart candles={candles} trades={trades} chartStyle={chartStyle} entryPrice={entry?.price} />
        )}
      </div>
    </div>
  );
}
