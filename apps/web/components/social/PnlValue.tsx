'use client';

import { cn } from '@kamby/ui';
import { useValueFlash } from '@/hooks/useValueFlash';
import { formatPercent, formatSignedCompactUsd, priceDirection } from '@/lib/format';

/** A realized-PnL figure — $ (primary) and % (secondary, muted), both sharing one
 *  up/down/flat color so the two never visually disagree. Sibling to PriceChange, same
 *  null-vs-zero honesty: `usd === null` means "no matched PnL in this window at all" (see
 *  PnlWindowStatsSchema in packages/domain/src/pnl.ts), rendered as an em dash, never a
 *  fabricated $0.00. Also shares PriceChange's real-delta flash (hooks/useValueFlash.ts) —
 *  briefly glows when `usd` actually changes between two renders, e.g. a fresh trade
 *  landing in this window. */
export function PnlValue({
  usd,
  pct,
  size = 'md',
  className,
}: {
  usd: number | null;
  pct: number | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const direction = priceDirection(usd);
  const flash = useValueFlash(usd);
  const sizeClass = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded px-0.5 font-mono tabular-nums transition-[box-shadow,color,background-color] duration-500',
        sizeClass,
        flash === 'up' && 'bg-up/10 text-up shadow-glow-up',
        flash === 'down' && 'bg-down/10 text-down shadow-glow-down',
        !flash && direction === 'up' && 'text-up',
        !flash && direction === 'down' && 'text-down',
        !flash && direction === 'flat' && 'text-ink-400',
        className,
      )}
    >
      <span>{formatSignedCompactUsd(usd)}</span>
      {pct !== null && <span className="opacity-70">{formatPercent(pct)}</span>}
    </span>
  );
}
