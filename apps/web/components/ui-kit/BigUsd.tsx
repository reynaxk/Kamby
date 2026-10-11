import { cn } from '@kamby/ui';

/**
 * A headline dollar amount with the cents dimmed — "$2,481" bright, ".59" soft (2026-10-09, app
 * redesign). The eye reads the whole-dollar part first, the way trading apps show balances.
 */
export function BigUsd({ value, className, centsClassName }: { value: number | null; className?: string; centsClassName?: string }) {
  // A balance not known yet reads $0.00, never a dash (owner 2026-10-11: "—" looked broken).
  const amount = value === null || !Number.isFinite(value) ? 0 : value;
  const negative = amount < 0;
  const [whole, cents] = Math.abs(amount).toFixed(2).split('.');
  return (
    <span className={cn('tabular-nums', className)}>
      {negative ? '-' : ''}${Number(whole).toLocaleString('en-US')}
      <span className={cn('opacity-40', centsClassName)}>.{cents}</span>
    </span>
  );
}
