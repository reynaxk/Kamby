'use client';

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
