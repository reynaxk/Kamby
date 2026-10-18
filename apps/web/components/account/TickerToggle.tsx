'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { setTickerEnabled, useTickerEnabled } from '@/lib/ticker-pref';

/** "Coin ticker" on / off (2026-10-18) — the scrolling prices bar at the bottom of the screen on
 *  a computer. Off by default; remembered on this device. */
export function TickerToggle() {
  const t = useTranslations('account');
  const on = useTickerEnabled();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setTickerEnabled(!on)}
      className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border border-line bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-ink-900 transition-colors hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      title={t('tickerHint')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
      {t('ticker')}
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-accent' : 'bg-white/15')} aria-hidden>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-200', on ? 'left-[1.125rem]' : 'left-0.5')} />
      </span>
    </button>
  );
}
