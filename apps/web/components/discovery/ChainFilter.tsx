'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { badgeChainFor, ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

export type ChainFilterValue = 'all' | BadgeChain;

const CHAINS: { chain: BadgeChain; label: string }[] = [
  { chain: 'solana', label: 'Solana' },
  { chain: 'base', label: 'Base' },
  { chain: 'bnb', label: 'BNB' },
  { chain: 'robinhood', label: 'Robinhood' },
];
const STORAGE_KEY = 'kamby:chain-filter';

/** The chain filter the user picked last, remembered on this device. */
export function useChainFilter(): [ChainFilterValue, (value: ChainFilterValue) => void] {
  const [value, setValue] = useState<ChainFilterValue>('all');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'all' || CHAINS.some((c) => c.chain === saved)) setValue(saved as ChainFilterValue);
    } catch {
      // storage unavailable — 'all' stays
    }
  }, []);
  const choose = (next: ChainFilterValue) => {
    setValue(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // applied, just not remembered
    }
  };
  return [value, choose];
}

/** Whether a coin on `chainIdentifier` passes the filter. Pump.fun feeds are Solana. */
export function matchesChain(filter: ChainFilterValue, chainIdentifier: string): boolean {
  return filter === 'all' || badgeChainFor(chainIdentifier) === filter;
}

/**
 * Pick one chain's coins (owner, 2026-10-13: "we cannot choose any blockchains"). Was a
 * scrolling row of chips; since 2026-10-28 (owner: "tap and drop") one button showing the
 * current choice that opens a short list — All, then each chain with its mark.
 */
/** `compact` (2026-10-29, like GMGN): just the chain's mark and a chevron, to sit at the end of a tab row. */
export function ChainFilter({ value, onChange, className, compact }: { value: ChainFilterValue; onChange: (value: ChainFilterValue) => void; className?: string; compact?: boolean }) {
  const tLb = useTranslations('leaderboard');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const current = CHAINS.find((c) => c.chain === value);
  const options: { value: ChainFilterValue; label: string }[] = [{ value: 'all', label: tLb('allChains') }, ...CHAINS.map((c) => ({ value: c.chain, label: c.label }))];

  return (
    <div ref={box} className={cn('relative px-1 max-md:px-4', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Blockchain"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-xl border px-2.5 font-display text-xs font-bold transition-colors',
          open || value !== 'all' ? 'border-accent/50 bg-accent/10 text-ink-900' : 'border-white/10 bg-white/[0.04] text-ink-900 hover:border-white/20',
        )}
      >
        {current ? <Mark chain={current.chain} /> : <AllMark />}
        {!compact && (current ? current.label : tLb('allChains'))}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={cn('text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Blockchain"
          className={cn(
            'absolute top-full z-40 mt-1.5 w-48 overflow-hidden rounded-2xl border border-white/10 bg-surface p-1 shadow-xl shadow-black/50',
            compact ? 'right-1 max-md:right-4' : 'left-1 max-md:left-4',
          )}
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left font-display text-sm font-semibold transition-colors',
                  value === o.value ? 'bg-white/[0.08] text-ink-900' : 'text-ink-600 hover:bg-white/[0.05] hover:text-ink-900',
                )}
              >
                {o.value === 'all' ? <AllMark /> : <Mark chain={o.value} />}
                <span className="flex-1">{o.label}</span>
                {value === o.value && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mark({ chain }: { chain: BadgeChain }) {
  return (
    <span className="relative h-4 w-4 shrink-0">
      <ChainBadge chain={chain} className="!static !h-4 !w-4 !ring-0" />
    </span>
  );
}

function AllMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink-400" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}
