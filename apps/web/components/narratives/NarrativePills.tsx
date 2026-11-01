'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { narrativesOf, newsTokenKey, type NarrativesSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useNarratives } from '@/lib/narratives-client';

const SHOWN = 12;

interface Taggable {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
}

/** Exported for tests. `rows` in one narrative, hottest coin first (coins the API hasn't scored last). */
export function filterByNarrative<T>(rows: T[], narrative: string | null, coin: (row: T) => Taggable, snapshot: NarrativesSnapshot | null): T[] {
  if (!narrative) return rows;
  const heat = new Map((snapshot?.narratives.find((n) => n.id === narrative)?.tokens ?? []).map((t) => [newsTokenKey(t.chainIdentifier, t.tokenAddress), t.heat]));
  const score = (row: T) => {
    const c = coin(row);
    return heat.get(newsTokenKey(c.chainIdentifier, c.tokenAddress)) ?? -1;
  };
  return rows.filter((row) => narrativesOf(coin(row)).includes(narrative)).sort((a, b) => score(b) - score(a));
}

/**
 * The Trade list's narrative pills (2026-10-31): the hottest narratives right now; tapping one
 * narrows the list to its coins, hottest first. Tapping it again shows everything.
 */
export function NarrativePills({ value, onChange, className }: { value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const t = useTranslations('narratives');
  const snapshot = useNarratives();
  const list = (snapshot?.narratives ?? []).slice(0, SHOWN);
  if (list.length === 0) return null;
  return (
    <div role="group" aria-label={t('pillsLabel')} className={cn('flex gap-1.5 overflow-x-auto [scrollbar-width:none]', className)}>
      {list.map((n) => {
        const on = value === n.id;
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : n.id)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 font-display text-[0.7rem] font-bold transition-colors',
              on ? 'border-[#FB923C]/50 bg-[#FB923C]/10 text-ink-900' : 'border-line text-ink-600 hover:text-ink-900',
            )}
          >
            <span aria-hidden>{n.emoji}</span>
            {n.name}
            {n.heat >= 80 && <span aria-hidden className="text-[0.65rem]">🔥</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same pick as one chip with a list (2026-11-01 tidy pass): it sits in the Home list's tab
 * row next to the chain menu, so the narratives don't need a row of their own.
 */
export function NarrativeMenu({ value, onChange, className }: { value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const t = useTranslations('narratives');
  const snapshot = useNarratives();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const list = (snapshot?.narratives ?? []).slice(0, SHOWN);
  if (list.length === 0) return null;
  const current = list.find((n) => n.id === value);
  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('pillsLabel')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-8 items-center gap-1 rounded-xl border px-2.5 font-display text-xs font-bold transition-colors',
          open || current ? 'border-[#FB923C]/50 bg-[#FB923C]/10 text-ink-900' : 'border-white/10 bg-white/[0.04] text-ink-900 hover:border-white/20',
        )}
      >
        <span aria-hidden>{current ? current.emoji : '🔥'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={cn('text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul role="listbox" aria-label={t('pillsLabel')} className="absolute right-0 top-full z-40 mt-1.5 max-h-80 w-56 overflow-y-auto rounded-2xl border border-white/10 bg-surface p-1 shadow-xl shadow-black/50">
          {[{ id: null as string | null, emoji: '✦', name: t('filter_all'), heat: 0 }, ...list].map((n) => (
            <li key={n.id ?? 'all'}>
              <button
                type="button"
                role="option"
                aria-selected={value === n.id}
                onClick={() => {
                  onChange(n.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left font-display text-sm font-semibold transition-colors',
                  value === n.id ? 'bg-white/[0.08] text-ink-900' : 'text-ink-600 hover:bg-white/[0.05] hover:text-ink-900',
                )}
              >
                <span aria-hidden className="w-5 text-center">{n.emoji}</span>
                <span className="flex-1 truncate">{n.name}</span>
                {n.heat >= 80 && <span aria-hidden className="text-xs">🔥</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
