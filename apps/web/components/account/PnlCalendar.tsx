'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PnlHistory } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchMyPnlHistory } from '@/lib/discovery-client';
import { formatSignedCompactUsd } from '@/lib/format';

const WEEKS = 5;

/** Exported for tests. The calendar's days (oldest first, ending today, starting on a Monday)
 *  with each day's realized PnL, or null for a day with no closed trades. */
export function calendarDays(history: PnlHistory | null, today = new Date()): { date: string; day: number; pnl: number | null }[] {
  const byDate = new Map((history?.points ?? []).map((p) => [p.date, p.realizedPnlUsd]));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // Back to the Monday that makes WEEKS full rows ending this week.
  const weekday = (end.getUTCDay() + 6) % 7;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - weekday - (WEEKS - 1) * 7);
  const out: { date: string; day: number; pnl: number | null }[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const pnl = byDate.get(date);
    out.push({ date, day: d.getUTCDate(), pnl: pnl === undefined || pnl === 0 ? null : pnl });
  }
  return out;
}

/**
 * Your realized PnL as a month-style calendar (2026-10-28, GMGN's "P&L Calendar", simpler):
 * green days, red days, quiet days, with the win/loss day count on top.
 */
export function PnlCalendar() {
  const t = useTranslations('you');
  const locale = useLocale();
  const { hidden } = useBalanceVisibility();
  const [history, setHistory] = useState<PnlHistory | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyPnlHistory(WEEKS * 7)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistory('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (history === null) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const days = calendarDays(history === 'error' ? null : history);
  const wins = days.filter((d) => (d.pnl ?? 0) > 0).length;
  const losses = days.filter((d) => (d.pnl ?? 0) < 0).length;
  const total = days.reduce((sum, d) => sum + (d.pnl ?? 0), 0);
  const biggest = Math.max(1, ...days.map((d) => Math.abs(d.pnl ?? 0)));
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 26 + i))));

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <p className="font-body text-xs font-semibold text-ink-400">{t('calendar')}</p>
          <p className={cn('mt-0.5 font-display text-2xl font-bold tabular-nums', total > 0 ? 'text-up' : total < 0 ? 'text-down' : 'text-ink-900', hidden && 'select-none blur-sm')}>
            {formatSignedCompactUsd(total)}
          </p>
        </div>
        <p className="font-body text-xs font-semibold tabular-nums">
          <span className="text-up">{t('winDays', { n: wins })}</span>
          <span className="mx-1.5 text-ink-400">·</span>
          <span className="text-down">{t('lossDays', { n: losses })}</span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {weekdayNames.map((name, i) => (
          <span key={i} className="pb-0.5 text-center font-body text-[0.62rem] font-semibold uppercase text-ink-400">
            {name}
          </span>
        ))}
        {days.map((d) => {
          const strength = d.pnl === null ? 0 : 0.12 + 0.38 * Math.min(1, Math.abs(d.pnl) / biggest);
          return (
            <span
              key={d.date}
              title={d.pnl === null ? d.date : `${d.date} · ${formatSignedCompactUsd(d.pnl)}`}
              className="flex aspect-square flex-col items-center justify-center rounded-xl"
              style={{ background: d.pnl === null ? 'rgba(255,255,255,0.03)' : d.pnl > 0 ? `rgba(0,255,135,${strength})` : `rgba(255,59,105,${strength})` }}
            >
              <span className={cn('font-body text-[0.62rem] font-semibold', d.pnl === null ? 'text-ink-400' : 'text-ink-900')}>{d.day}</span>
              {d.pnl !== null && (
                <span className={cn('font-display text-[0.58rem] font-bold tabular-nums text-ink-900', hidden && 'select-none blur-[3px]')}>
                  {formatSignedCompactUsd(d.pnl).replace('.00', '')}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
