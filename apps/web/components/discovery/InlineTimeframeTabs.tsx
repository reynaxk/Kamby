'use client';

import { TIMEFRAMES } from '@kamby/domain';
import { cn } from '@kamby/ui';
import type { ChartTimeframe } from '@/lib/chart-data';

export const DEFAULT_CHART_TIMEFRAMES: readonly ChartTimeframe[] = ['live', ...TIMEFRAMES];

/** The chart's timeframe switcher — buttons, not links: switching refetches (or reuses cached)
 *  candles in place without leaving the page. Used by every chart (Discover's terminal, the
 *  market page, the Solana page). "Live" is the real-time price line (LivePriceChart). */
export function InlineTimeframeTabs({
  active,
  onChange,
  timeframes = DEFAULT_CHART_TIMEFRAMES,
}: {
  active: ChartTimeframe;
  onChange: (tf: ChartTimeframe) => void;
  timeframes?: readonly ChartTimeframe[];
}) {
  return (
    <div className="kamby-timeframe-tabs inline-flex rounded-lg border border-line bg-surface p-0.5">
      {timeframes.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          aria-pressed={tf === active}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[0.7rem] font-medium tracking-tight transition-colors',
            tf === active ? 'bg-accent text-accent-ink' : 'text-ink-400 hover:text-ink-900',
          )}
        >
          {tf === 'live' && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tf === active ? 'bg-accent-ink' : 'bg-up')} />}
          {tf === 'live' ? 'Live' : tf}
        </button>
      ))}
    </div>
  );
}
