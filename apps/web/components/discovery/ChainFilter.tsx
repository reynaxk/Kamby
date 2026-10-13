'use client';

import { useEffect, useState } from 'react';
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
 * One slim row to see coins from one chain only (owner, 2026-10-13: "we cannot choose any
 * blockchains") — All, then each chain with its mark. Sits under the category chips.
 */
export function ChainFilter({ value, onChange, className }: { value: ChainFilterValue; onChange: (value: ChainFilterValue) => void; className?: string }) {
  const tLb = useTranslations('leaderboard');
  return (
    <div role="radiogroup" aria-label="Blockchain" className={cn('flex gap-1.5 overflow-x-auto px-1 max-md:px-4', className)}>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'all'}
        onClick={() => onChange('all')}
        className={cn('shrink-0 rounded-full px-3 py-1 font-display text-xs font-semibold transition-colors', value === 'all' ? 'bg-white/10 text-ink-900' : 'text-ink-400')}
      >
        {tLb('allChains')}
      </button>
      {CHAINS.map(({ chain, label }) => (
        <button
          key={chain}
          type="button"
          role="radio"
          aria-checked={value === chain}
          onClick={() => onChange(chain)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs font-semibold transition-colors',
            value === chain ? 'bg-white/10 text-ink-900' : 'text-ink-400',
          )}
        >
          <span className="relative h-3.5 w-3.5 shrink-0">
            <ChainBadge chain={chain} className="!static !h-3.5 !w-3.5 !ring-0" />
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}
