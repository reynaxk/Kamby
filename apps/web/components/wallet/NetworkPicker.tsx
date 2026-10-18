'use client';

import { cn } from '@kamby/ui';
import { ChainBadge } from '@/components/market/ChainBadge';
import { SEND_CHAINS, type SendChainOption } from '@/lib/send';

/**
 * The network choice in the Deposit / Withdraw / Send sheets (2026-10-18 audit: four pills in a
 * row squeezed "Robinhood Chain" onto two lines). A 2×2 grid of tiles, each with the chain's mark.
 */
export function NetworkPicker({ label, value, onChange }: { label: string; value: SendChainOption; onChange: (chain: SendChainOption) => void }) {
  return (
    <div>
      <div className="font-body text-xs text-ink-600">{label}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {SEND_CHAINS.map((c) => {
          const on = value.slug === c.slug;
          return (
            <button
              key={c.slug}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(c)}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2.5 text-left font-body text-sm font-semibold transition-[transform,border-color,color] active:scale-[0.97]',
                on ? 'border-accent/70 bg-accent/[0.1] text-ink-900' : 'border-white/[0.08] bg-white/[0.03] text-ink-600 hover:border-white/20 hover:text-ink-900',
              )}
            >
              <span aria-hidden className="relative h-5 w-5 shrink-0">
                <ChainBadge chain={c.slug} className="!static !h-5 !w-5 !ring-0" />
              </span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span
                aria-hidden
                className={cn('h-2 w-2 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-white/10')}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
