import type { KambyTrade } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatSignedCompactUsd } from '@/lib/format';

/** Sells with a matched PnL, oldest first. */
function sells(trades: KambyTrade[]): KambyTrade[] {
  return trades.filter((x) => x.side === 'SELL' && x.pnlUsd !== null).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The trader card's line (2026-10-30 redesign, owner's concepts): their realized PnL added up
 * sell by sell — the shape of their run. Nothing under two sells.
 */
export function PnlRunLine({ trades, className }: { trades: KambyTrade[]; className?: string }) {
  const list = sells(trades);
  if (list.length < 2) return null;
  let sum = 0;
  const points = [0, ...list.map((x) => (sum += x.pnlUsd!))];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 600;
  const h = 90;
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(6 + ((max - v) / span) * (h - 12)).toFixed(1)}`).join(' ');
  const up = sum >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={up ? 'rgba(0,230,118,0.08)' : 'rgba(255,59,105,0.08)'} />
      <path d={d} fill="none" stroke={up ? '#00E676' : '#FF3B69'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Win rate as a ring — green from half up. */
export function WinRing({ rate, size = 76 }: { rate: number; size?: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={`${rate}%`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={rate >= 50 ? '#00E676' : '#FF3B69'}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${(rate / 100) * c} ${c}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="20.6" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#F0F2F8">
        {rate}%
      </text>
    </svg>
  );
}

/**
 * The last 28 days of their Kamby sells as a calendar — green days made money, red lost, grey
 * no sell. Built from the same recent trades the activity list shows.
 */
export function PnlDays({ trades, title }: { trades: KambyTrade[]; title: string }) {
  const list = sells(trades);
  if (list.length === 0) return null;
  const byDay = new Map<string, number>();
  for (const x of list) byDay.set(x.at.slice(0, 10), (byDay.get(x.at.slice(0, 10)) ?? 0) + x.pnlUsd!);
  const today = new Date();
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 27 + i));
    const key = d.toISOString().slice(0, 10);
    return { key, day: d.getUTCDate(), pnl: byDay.get(key) ?? null };
  });
  const green = days.filter((d) => (d.pnl ?? 0) > 0).length;
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink-900">{title}</h2>
        <span className="font-mono text-xs text-up">{green} ▲</span>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {days.map((d) => (
          <span
            key={d.key}
            title={d.pnl === null ? d.key : `${d.key} · ${formatSignedCompactUsd(d.pnl)}`}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md font-mono text-[0.62rem]',
              d.pnl === null ? 'bg-white/[0.03] text-ink-400' : d.pnl > 0 ? 'bg-up/25 text-[#7DFFC0]' : d.pnl < 0 ? 'bg-down/25 text-[#FF9CB4]' : 'bg-white/[0.06] text-ink-600',
            )}
          >
            {d.day}
          </span>
        ))}
      </div>
    </section>
  );
}
