'use client';

import { cn } from '@kamby/ui';
import { useValueFlash } from '@/hooks/useValueFlash';
import { formatPercent, priceDirection } from '@/lib/format';

/**
 * Colors by sign as always, and now also briefly glows when the underlying number actually
 * changes between two renders (see hooks/useValueFlash.ts) — real-delta-driven, since this
 * app has no per-tick price stream: callers re-render with fresh server data on each
 * AutoRefresh poll (15-20s), so the flash only fires on a genuine change between two real
 * responses, never a decorative/fake pulse. Public props are unchanged, so every existing
 * caller (TokenCard, MarketTable, TokenMetricsBar, WatchlistView, PersonalizedDiscovery)
 * gets the flash for free.
 */
export function PriceChange({ value, className }: { value: number | null; className?: string }) {
  const direction = priceDirection(value);
  const flash = useValueFlash(value);
  return (
    <span
      className={cn(
        'inline-block rounded px-0.5 font-mono text-sm tabular-nums transition-[box-shadow,color,background-color] duration-500',
        flash === 'up' && 'bg-up/10 text-up shadow-glow-up',
        flash === 'down' && 'bg-down/10 text-down shadow-glow-down',
        !flash && direction === 'up' && 'text-up',
        !flash && direction === 'down' && 'text-down',
        !flash && direction === 'flat' && 'text-ink-400',
        className,
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
