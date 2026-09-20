'use client';

import { TIMEFRAMES, type Timeframe } from '@kamby/domain';
import { cn } from '@kamby/ui';

/** Client-interactive sibling to components/market/TimeframeTabs.tsx, for Discover's
 *  in-place terminal — that one is real server-navigation (`<Link href="?timeframe=">`,
 *  its own doc comment says so explicitly) and stays untouched, still serving the token
 *  detail page. This one calls back into DiscoverTerminal's own `timeframe` state instead
 *  of navigating, since switching timeframes here must refetch candles for whichever token
 *  is currently selected without leaving the page. Same visual treatment, deliberately. */
export function InlineTimeframeTabs({ active, onChange }: { active: Timeframe; onChange: (tf: Timeframe) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            'rounded-md px-2.5 py-1 font-mono text-xs font-medium tracking-tight transition-all',
            tf === active ? 'bg-accent text-accent-ink shadow-glow-accent' : 'text-ink-400 hover:text-ink-900',
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
