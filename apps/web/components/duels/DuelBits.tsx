'use client';

import { cn } from '@kamby/ui';
import { formatPercent } from '@/lib/format';

/** The two corners of the ring: Kamby green vs cyan. */
export const SIDE_COLOR = { challenger: '#00FF87', opponent: '#00E5FF' } as const;

/**
 * A half-ring PnL gauge: the arc fills from the middle — right for profit, left for loss —
 * up to ±50% (beyond that it's simply full). The big number is the real %.
 */
export function PnlGauge({ pct, color, size = 132 }: { pct: number | null; color: string; size?: number }) {
  const r = 52;
  const half = Math.PI * r; // the half circle's length
  const clamp = pct === null ? 0 : Math.max(-50, Math.min(50, pct)) / 50; // -1..1
  const length = Math.abs(clamp) * (half / 2);
  const up = (pct ?? 0) >= 0;
  const stroke = pct === null ? 'rgba(255,255,255,0.15)' : up ? color : '#FF3B69';
  return (
    <div className="relative" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 120 70" width={size} height={size * 0.62} aria-hidden>
        <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" strokeLinecap="round" />
        {/* centre tick */}
        <line x1="60" y1="6" x2="60" y2="15" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
        {pct !== null && length > 0.5 && (
          <path
            d="M8 62 A52 52 0 0 1 112 62"
            fill="none"
            stroke={stroke}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${length} ${half}`}
            strokeDashoffset={up ? -half / 2 : -(half / 2 - length)}
            style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.2,0.8,0.2,1), stroke-dashoffset 0.6s cubic-bezier(0.2,0.8,0.2,1)' }}
          />
        )}
      </svg>
      <span
        className={cn('absolute inset-x-0 bottom-0 text-center font-display font-black tabular-nums tracking-tight', pct === null ? 'text-ink-400' : up ? '' : 'text-down')}
        style={{ fontSize: size * 0.2, color: pct !== null && up ? color : undefined }}
      >
        {pct === null ? '—' : formatPercent(pct)}
      </span>
    </div>
  );
}

/** A crossed-swords mark for duels (no emoji on neon surfaces). */
export function Swords({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2" />
    </svg>
  );
}

/** The VS chip between two duelists. */
export function VsChip({ className }: { className?: string }) {
  return (
    <span
      className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 font-display text-[0.7rem] font-black italic tracking-tight text-white', className)}
      style={{ background: 'linear-gradient(135deg, rgba(0,255,135,0.25), rgba(14,20,48,0.95) 50%, rgba(0,229,255,0.25))' }}
    >
      VS
    </span>
  );
}
