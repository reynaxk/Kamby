'use client';

import type { PnlHistory } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useEffect, useState } from 'react';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { formatSignedCompactUsd, priceDirection } from '@/lib/format';
import { fetchMyPnlHistory, hasStoredSession } from '@/lib/discovery-client';

const WIDTH = 480;
const HEIGHT = 120;
const PAD = 4;

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/**
 * Realized PnL over the last N days — see PnlHistoryPointSchema's own doc comment
 * (packages/domain/src/pnl.ts) for exactly what this is and, deliberately, isn't: a chart
 * of money actually realized day by day, not a reconstructed mark-to-market portfolio
 * value (this codebase has no historical price snapshots to honestly build that from).
 * Same Sparkline.tsx-style plain SVG polyline, scaled up, plus a zero baseline since a
 * cumulative realized-PnL line crossing zero is the one thing on this chart most worth
 * seeing at a glance.
 */
export function PnlHistoryChart({ days = 30 }: { days?: number }) {
  const [state, setState] = useState<State>('loading');
  const [history, setHistory] = useState<PnlHistory | null>(null);
  const { hidden } = useBalanceVisibility();

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    fetchMyPnlHistory(days)
      .then((result) => {
        setHistory(result);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, [days]);

  if (state === 'no-session') {
    return <EmptyState title="No PnL history yet." detail="Connect a wallet and trade to start tracking this." />;
  }
  if (state === 'loading') {
    return <Skeleton className="h-32 w-full rounded-2xl" />;
  }
  if (state === 'error' || !history) {
    return <EmptyState title="Couldn't load your PnL history." detail="Try again in a moment." />;
  }

  const points = history.points;
  const finalCumulative = points.at(-1)?.cumulativeRealizedPnlUsd ?? 0;
  const direction = priceDirection(finalCumulative);
  const strokeClass = direction === 'up' ? 'stroke-up' : direction === 'down' ? 'stroke-down' : 'stroke-ink-400';

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wide text-ink-400">Realized PnL — last {days}d</h3>
        <span
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            direction === 'up' && 'text-up',
            direction === 'down' && 'text-down',
            direction === 'flat' && 'text-ink-400',
            hidden && 'blur-sm select-none',
          )}
        >
          {formatSignedCompactUsd(finalCumulative)}
        </span>
      </div>
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Realized PnL over the last ${days} days: ${formatSignedCompactUsd(finalCumulative)}`}
        className={cn(hidden && 'blur-sm select-none')}
      >
        <ZeroBaseline points={points.map((p) => p.cumulativeRealizedPnlUsd)} />
        <PnlPolyline points={points.map((p) => p.cumulativeRealizedPnlUsd)} strokeClass={strokeClass} />
      </svg>
    </div>
  );
}

function scaleY(values: number[], value: number): number {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  return PAD + (1 - (value - min) / range) * (HEIGHT - PAD * 2);
}

function ZeroBaseline({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  const y = scaleY(points, 0);
  return <line x1={0} y1={y} x2={WIDTH} y2={y} className="stroke-line" strokeWidth={1} strokeDasharray="3 3" />;
}

function PnlPolyline({ points, strokeClass }: { points: number[]; strokeClass: string }) {
  if (points.length < 2) return null;
  const stepX = (WIDTH - PAD * 2) / (points.length - 1);
  const coords = points.map((value, i) => `${(PAD + i * stepX).toFixed(1)},${scaleY(points, value).toFixed(1)}`);
  return (
    <polyline points={coords.join(' ')} fill="none" className={strokeClass} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
  );
}
