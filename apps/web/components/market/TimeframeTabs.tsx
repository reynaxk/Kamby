import { TIMEFRAMES, type Timeframe } from '@kamby/domain';
import { cn } from '@kamby/ui';
import Link from 'next/link';

/** Plain links updating ?timeframe= — each tab is a real server-rendered page, no client state.
 *  `chain` added 2026-09-16 for the /market/[chain]/[address] route shape (BNB Chain going
 *  live) — every tab must preserve which chain's version of this token is being viewed. */
export function TimeframeTabs({ chain, address, active }: { chain: string; address: string; active: Timeframe }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {TIMEFRAMES.map((tf) => (
        <Link
          key={tf}
          href={`/market/${chain}/${address}?timeframe=${tf}`}
          className={cn(
            'rounded-md px-2.5 py-1 font-mono text-xs font-medium tracking-tight transition-all',
            tf === active ? 'bg-accent text-accent-ink shadow-glow-accent' : 'text-ink-400 hover:text-ink-900',
          )}
        >
          {tf}
        </Link>
      ))}
    </div>
  );
}
