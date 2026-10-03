'use client';

import { useEffect, useState } from 'react';
import { cn } from '@kamby/ui';
import type { ChartStyle } from './KambyChart';

const STORAGE_KEY = 'kamby:chart-style';

/** The chart style the user picked last (candles by default), remembered on this device. */
export function useChartStyle(): [ChartStyle, (style: ChartStyle) => void] {
  const [style, setStyle] = useState<ChartStyle>('candles');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'line' || saved === 'candles') setStyle(saved);
    } catch {
      // storage unavailable — default stays
    }
  }, []);
  const choose = (next: ChartStyle) => {
    setStyle(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still applied
    }
  };
  return [style, choose];
}

/** Candles ⇄ line switch next to the timeframe tabs (user request 2026-10-03). */
export function ChartStyleToggle({ value, onChange }: { value: ChartStyle; onChange: (style: ChartStyle) => void }) {
  const option = (style: ChartStyle, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(style)}
      aria-pressed={value === style}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-6 w-7 items-center justify-center rounded-md transition-colors',
        value === style ? 'bg-accent text-accent-ink' : 'text-ink-400 hover:text-ink-900',
      )}
    >
      {icon}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {option(
        'candles',
        'Candles',
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <rect x="2" y="5" width="3" height="6" rx="0.5" />
          <rect x="3.25" y="2.5" width="0.5" height="11" />
          <rect x="7" y="3" width="3" height="7" rx="0.5" />
          <rect x="8.25" y="1" width="0.5" height="11" />
          <rect x="12" y="6" width="3" height="5" rx="0.5" />
          <rect x="13.25" y="4" width="0.5" height="9.5" />
        </svg>,
      )}
      {option(
        'line',
        'Line',
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M1.5 12 5.5 7.5 8.5 9.5 14.5 3" />
        </svg>,
      )}
    </div>
  );
}
