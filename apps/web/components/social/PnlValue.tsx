import { cn } from '@kamby/ui';
import { formatPercent, formatSignedCompactUsd, priceDirection } from '@/lib/format';

/** A realized-PnL figure — $ (primary) and % (secondary, muted), both sharing one
 *  up/down/flat color so the two never visually disagree. Sibling to PriceChange, same
 *  null-vs-zero honesty: `usd === null` means "no matched PnL in this window at all" (see
 *  PnlWindowStatsSchema in packages/domain/src/pnl.ts), rendered as an em dash, never a
 *  fabricated $0.00. */
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
  const sizeClass = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 font-mono tabular-nums',
        sizeClass,
        direction === 'up' && 'text-up',
        direction === 'down' && 'text-down',
        direction === 'flat' && 'text-ink-400',
        className,
      )}
    >
      <span>{formatSignedCompactUsd(usd)}</span>
      {pct !== null && <span className="opacity-70">{formatPercent(pct)}</span>}
    </span>
  );
}
