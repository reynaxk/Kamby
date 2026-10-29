'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { KambyTrade, TraderProfile } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { API_BASE } from '@/lib/session-client';
import { formatSignedCompactUsd } from '@/lib/format';

/**
 * The PnL tab's four lines (2026-10-29, GMGN's "You → PnL"): total, open, realized (30d) and
 * win rate over your recent Kamby sells. Public numbers — the same ones your trader page shows.
 */
export function PnlSummary({ address, openPnl }: { address: string; openPnl: number }) {
  const t = useTranslations('you');
  const { hidden } = useBalanceVisibility();
  const [data, setData] = useState<{ realized: number | null; winRate: number | null; wins: number; losses: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const base = `${API_BASE}/v1/social/traders/${encodeURIComponent(address)}`;
    Promise.all([
      fetch(base).then((r) => (r.ok ? (r.json() as Promise<TraderProfile>) : null)),
      fetch(`${base}/kamby-trades`).then((r) => (r.ok ? (r.json() as Promise<KambyTrade[]>) : [])),
    ])
      .then(([profile, trades]) => {
        if (cancelled) return;
        const sells = trades.filter((x) => x.side === 'SELL' && x.pnlUsd !== null);
        const wins = sells.filter((x) => x.pnlUsd! > 0).length;
        setData({
          realized: profile?.realizedPnl?.['30d'].realizedPnlUsd ?? null,
          winRate: sells.length ? Math.round((wins / sells.length) * 100) : null,
          wins,
          losses: sells.length - wins,
        });
      })
      .catch(() => !cancelled && setData({ realized: null, winRate: null, wins: 0, losses: 0 }));
    return () => {
      cancelled = true;
    };
  }, [address]);

  const total = (data?.realized ?? 0) + openPnl;
  const tone = (v: number | null) => (v === null || v === 0 ? 'text-ink-900' : v > 0 ? 'text-up' : 'text-down');
  const rows: [string, string, string][] = [
    [t('totalPnl'), data ? formatSignedCompactUsd(total) : '…', data ? tone(total) : 'text-ink-400'],
    [t('openPnl'), formatSignedCompactUsd(openPnl), tone(openPnl)],
    [t('realized30d'), data ? (data.realized === null ? '—' : formatSignedCompactUsd(data.realized)) : '…', tone(data?.realized ?? null)],
    [
      t('winRate'),
      data ? (data.winRate === null ? '—' : `${data.winRate}% · ${data.wins}W/${data.losses}L`) : '…',
      data?.winRate == null ? 'text-ink-900' : data.winRate >= 50 ? 'text-up' : 'text-down',
    ],
  ];
  return (
    <dl className="kamby-glass divide-y divide-white/[0.05] rounded-2xl px-4">
      {rows.map(([label, value, cls]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2.5">
          <dt className="font-body text-sm text-ink-400">{label}</dt>
          <dd className={cn('font-display text-sm font-bold tabular-nums', cls, hidden && 'select-none blur-sm')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
