'use client';

import { cn } from '@kamby/ui';
import { formatCompactUsd } from '@/lib/format';
import type { ChartSource } from '@/lib/chart-data';
import { useTokenStats } from '@/lib/use-live-price';

/**
 * A coin's trading stats under its header (user request 2026-10-07: "more info on every coin,
 * 24h volume and stuff"): price change over 5m / 1h / 6h / 24h, buys vs sells, volume by
 * window, FDV and age. Fed by the coin's live price stream, so it costs no extra request and
 * refreshes every few seconds. Renders nothing until the first stats arrive.
 */
export function TokenStatsStrip({ source, className }: { source: ChartSource | null; className?: string }) {
  const stats = useTokenStats(source);
  if (!stats) return null;
  const { buys, sells } = stats.txns24h;
  const total = buys + sells;
  const buyShare = total > 0 ? (buys / total) * 100 : 50;

  return (
    <div className={cn('grid grid-cols-3 gap-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]', className)}>
      {(['m5', 'h1', 'h6'] as const).map((window) => (
        <Change key={window} label={WINDOW_LABEL[window]} value={stats.priceChangePct[window]} volume={stats.volumeUsd[window]} />
      ))}
      <div className="col-span-3 rounded-xl border border-line bg-surface-raised/60 px-3 py-2 lg:col-span-1">
        <div className="flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">
          <span>24h trades</span>
          <span className="tabular-nums">{total.toLocaleString('en-US')}</span>
        </div>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-down/70" aria-hidden="true">
          <div className="h-full rounded-full bg-up" style={{ width: `${buyShare}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[0.68rem] tabular-nums">
          <span className="text-up">{buys.toLocaleString('en-US')} buys</span>
          <span className="text-down">{sells.toLocaleString('en-US')} sells</span>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[0.6rem] text-ink-400">
          <span>FDV {formatCompactUsd(stats.fdvUsd)}</span>
          <span>Age {formatAge(stats.pairCreatedAtMs)}</span>
        </div>
      </div>
    </div>
  );
}

const WINDOW_LABEL = { m5: '5m', h1: '1h', h6: '6h' } as const;

/** "$0", "$711", "$7.7K" — whole dollars below $1K (cents are noise on a volume). */
function formatVolume(value: number): string {
  return value < 1_000 ? `$${Math.round(value).toLocaleString('en-US')}` : formatCompactUsd(value);
}

function Change({ label, value: raw, volume }: { label: string; value: number | null; volume: number }) {
  // No trades in the window means no move, not missing data.
  const value = raw === null && volume === 0 ? 0 : raw;
  const tone = value === null || value === 0 ? 'text-ink-600' : value > 0 ? 'text-up' : 'text-down';
  return (
    <div className="rounded-xl border border-line bg-surface-raised/60 px-3 py-2">
      <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={cn('font-mono text-sm font-semibold tabular-nums', tone)}>
        {value === null ? '—' : value === 0 ? '0%' : `${value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}%`}
      </div>
      <div className="font-mono text-[0.6rem] tabular-nums text-ink-400">Vol {formatVolume(volume)}</div>
    </div>
  );
}

/** "12m", "5h", "3d", "4mo" — how long the coin has traded. */
export function formatAge(createdAtMs: number | null, now = Date.now()): string {
  if (createdAtMs === null || createdAtMs > now) return '—';
  const minutes = Math.floor((now - createdAtMs) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}
