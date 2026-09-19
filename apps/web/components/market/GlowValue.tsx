'use client';

import { cn } from '@kamby/ui';
import { useValueFlash } from '@/hooks/useValueFlash';

/**
 * Wraps a numeric-ish string and briefly flashes emerald/pink when it changes value — the
 * "dynamic price cell glowing" ask, applied honestly: it only flashes when the underlying
 * *number* actually moved (a re-render with the same value, or a non-numeric string, never
 * flashes), and it never invents a direction — up is strictly "the new number is bigger."
 * Thin wrapper over `useValueFlash` (hooks/useValueFlash.ts), which also backs
 * `PriceChange`'s own flash.
 */
export function GlowValue({
  value,
  display,
  className,
}: {
  /** The plain numeric string used to decide whether — and which way — to flash. */
  value: string;
  /** What's actually rendered, e.g. `"$50.00"` while `value` stays `"50"` — defaults to
   *  `value` when the raw number is already what should be shown. */
  display?: string;
  className?: string;
}) {
  const numericValue = Number(value);
  const flash = useValueFlash(Number.isFinite(numericValue) ? numericValue : null);

  return (
    <span
      className={cn(
        'inline-block rounded px-0.5 transition-colors duration-500',
        flash === 'up' && 'bg-up/20 text-up',
        flash === 'down' && 'bg-down/20 text-down',
        !flash && 'text-ink-900',
        className,
      )}
    >
      {display ?? value}
    </span>
  );
}
