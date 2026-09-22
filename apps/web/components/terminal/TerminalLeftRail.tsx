'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { TradersSidebar } from '@/components/discovery/TradersSidebar';
import { TrenchesPanel } from './TrenchesPanel';

type Tab = 'trenches' | 'traders';

/**
 * The token detail page's left rail — a Trenches/Traders toggle, real comparison against
 * production (a screenshotted live token page, not a code read): the old unconditional
 * `<TrenchesPanel />` here showed Solana Pump.fun bonding-curve data even while looking at
 * a Base/BNB token, a real mismatch fomo.family's own left rail doesn't have (its sidebar
 * is never unrelated to the chain you're actually looking at).
 *
 * Deliberately a *smaller* version of DiscoverTokenList.tsx's own tab strip there, not a
 * reuse of it: that component's Markets/Trending/Movers/Volume tabs need the four
 * MarketSummary lists Discover's homepage already fetches server-side for its in-place
 * token-selection paradigm — fetching those again here, on a page that already has its one
 * selected token and navigates (rather than reselects in place) to look at another, would
 * be pure waste. Trenches and Traders are the two tabs there that need no such list at all
 * (TrenchesPanel/TradersSidebar are both fully self-contained), so those are the two this
 * page actually gets — real capability added (a way to see active traders that isn't
 * Solana-only), nothing removed (Trenches browsing is still one tap away, not lost).
 */
export function TerminalLeftRail() {
  const [tab, setTab] = useState<Tab>('trenches');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-2 gap-0.5 rounded-xl border border-line bg-surface p-0.5">
        {(['trenches', 'traders'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-1.5 py-1.5 font-display text-[0.65rem] font-bold uppercase tracking-wide transition-all',
              tab === t ? 'bg-accent/10 text-accent shadow-glow-accent' : 'text-ink-400 hover:text-ink-600',
            )}
          >
            {t === 'trenches' ? 'Trenches' : 'Traders'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'trenches' ? <TrenchesPanel /> : <TradersSidebar />}</div>
    </div>
  );
}
