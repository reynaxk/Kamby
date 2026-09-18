import Link from 'next/link';
import { cn } from '@kamby/ui';
import type { PnlWindow } from '@kamby/domain';
import { EmptyState } from '@/components/market/EmptyState';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PnlValue } from '@/components/social/PnlValue';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { formatCompactUsd } from '@/lib/format';
import { fetchLeaderboard } from '@/lib/social-api';

export const revalidate = 30;
export const metadata = { title: 'Leaderboard — Kamby' };

const WINDOWS: readonly PnlWindow[] = ['24h', '7d', '30d'];
const WINDOW_LABEL: Record<PnlWindow, string> = { '24h': '24H', '7d': '7D', '30d': '30D' };

function isPnlWindow(value: string | undefined): value is PnlWindow {
  return WINDOWS.includes(value as PnlWindow);
}

/**
 * The public realized-PnL leaderboard — see docs/TRADER_INTELLIGENCE.md#realized-pnl.
 * Glassmorphic treatment (`bg-white/[0.03]` + `backdrop-blur-xl` + `border-white/[0.06]`)
 * is scoped to this page's own rows/tabs rather than folded into the shared `Surface`
 * component — same "new surface, own treatment, no global change" precedent `.kamby-void`
 * itself established (see globals.css's own doc comment). `.kamby-void` still supplies the
 * base True-Deep-Black ground and monospace-friendly ink tokens everything here sits on.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { window?: string };
}) {
  const window: PnlWindow = isPnlWindow(searchParams.window) ? searchParams.window : '24h';
  const leaderboard = await fetchLeaderboard(window, 25);

  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Leaderboard
            </h1>
            <p className="mt-1 max-w-md font-mono text-xs text-ink-400">
              Ranked by real, realized profit on trades placed through Kamby — never a
              wallet&apos;s full on-chain activity.
            </p>
          </div>
          <nav className="inline-flex rounded-lg border border-white/[0.06] bg-white/[0.03] p-1 backdrop-blur-xl">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/leaderboard?window=${w}`}
                className={cn(
                  'rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors',
                  w === window ? 'bg-accent text-accent-ink' : 'text-ink-400 hover:text-ink-900',
                )}
              >
                {WINDOW_LABEL[w]}
              </Link>
            ))}
          </nav>
        </div>

        {leaderboard.entries.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No realized PnL yet."
              detail="Once a buy placed through Kamby is matched to a sell, ranked traders show up here."
            />
          </div>
        ) : (
          <ol className="mt-8 flex flex-col gap-2">
            {leaderboard.entries.map((entry, index) => (
              <li
                key={entry.userId}
                className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 backdrop-blur-xl"
              >
                <span className="w-7 shrink-0 text-center font-mono text-sm font-semibold tabular-nums text-ink-400">
                  #{index + 1}
                </span>
                <Link href={`/trader/${entry.walletAddress}`} className="min-w-0 flex-1">
                  <TraderIdentity
                    address={entry.walletAddress}
                    displayName={entry.username}
                    avatarUrl={entry.avatarUrl}
                    size="sm"
                  />
                </Link>
                <div className="shrink-0 text-right">
                  <PnlValue usd={entry.realizedPnlUsd} pct={entry.realizedPnlPct} />
                  <div className="mt-0.5 font-mono text-[0.65rem] text-ink-400">
                    {formatCompactUsd(entry.volumeUsd)} vol
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
