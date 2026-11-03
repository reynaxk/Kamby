'use client';

import { useState } from 'react';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useAccount } from 'wagmi';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import type { ChartSource } from '@/lib/chart-data';
import { formatCompactCount } from '@/lib/format';
import { HoldersPanel } from '@/components/terminal/HoldersPanel';
import { LiveTradesPanel } from '@/components/terminal/LiveTradesPanel';

/** Under the chart, full width (2026-11-02, like GMGN): the coin's live trades, or its holders. */
export function CoinBottomTabs({ source, className }: { source: ChartSource; className?: string }) {
  const tC = useTranslations('coin');
  const tU = useTranslations('ui');
  const [tab, setTab] = useState<'trades' | 'holders'>('trades');
  const [holderCount, setHolderCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'whales' | 'you'>('all');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const mine = [address, wallets[0]?.address].filter((a): a is string => Boolean(a));
  const tabs = [
    { id: 'trades' as const, label: tU('trades_18da') },
    { id: 'holders' as const, label: tC('holders'), badge: holderCount !== null ? formatCompactCount(holderCount) : undefined },
  ];
  return (
    <section className={cn('overflow-hidden rounded-xl border border-white/[0.06] bg-surface', className)}>
      <div role="tablist" className="flex items-center gap-5 border-b border-white/[0.06] px-4">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 py-2.5 font-display text-sm font-bold transition-colors',
              tab === x.id ? 'border-accent text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-900',
            )}
          >
            {x.label}
            {x.badge && <span className="font-mono text-[0.68rem] font-normal text-ink-400">{x.badge}</span>}
          </button>
        ))}
        {tab === 'trades' && (
          <div className="ml-auto flex items-center gap-1">
            {(['all', 'whales', 'you'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  'h-6 rounded-md border px-2 font-display text-[0.7rem] font-bold transition-colors',
                  filter === f ? 'border-accent/45 bg-accent/10 text-accent' : 'border-white/[0.08] text-ink-600 hover:text-ink-900',
                )}
              >
                {tC(f === 'all' ? 'fAll' : f === 'whales' ? 'fWhales' : 'fYou')}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Both stay mounted so switching back is instant and the holder count shows on the tab. */}
      <div className={cn('max-h-[420px] overflow-y-auto', tab !== 'trades' && 'hidden')}>
        <LiveTradesPanel source={source} filter={filter} mine={mine} />
      </div>
      <div className={cn('max-h-[420px] overflow-y-auto', tab !== 'holders' && 'hidden')}>
        <HoldersPanel source={source} onCount={setHolderCount} />
      </div>
    </section>
  );
}
