import Link from 'next/link';
import { cn, Surface } from '@kamby/ui';
import { CHAIN_REGISTRY, SUPPORTED_CHAIN_SLUGS, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';
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

/** `null` first — "All" is the real default every viewer sees before choosing to narrow. */
const CHAIN_FILTERS: readonly (LeaderboardChainFilter | null)[] = [null, 'solana', ...SUPPORTED_CHAIN_SLUGS];

function isPnlWindow(value: string | undefined): value is PnlWindow {
  return WINDOWS.includes(value as PnlWindow);
}

function isChainFilter(value: string | undefined): value is LeaderboardChainFilter {
  if (value === undefined) return false;
  return value === 'solana' || (SUPPORTED_CHAIN_SLUGS as readonly string[]).includes(value);
}

function chainLabel(chain: LeaderboardChainFilter | null): string {
  if (chain === null) return 'All';
  if (chain === 'solana') return 'Solana';
  return CHAIN_REGISTRY[chain].name;
}

/**
 * The public realized-PnL leaderboard — see docs/TRADER_INTELLIGENCE.md#realized-pnl.
 * Row cards use Surface's `glass` variant (see the visual overhaul) — formalized here from
 * this page's own original ad hoc `bg-white/[0.03]` + `backdrop-blur-xl` +
 * `border-white/[0.06]` formula, which is now `packages/ui/src/Surface.tsx`'s shared
 * `glass` variant (keyed off `ink-900` rather than a hardcoded white, so it stays correct
 * outside `.kamby-void` too). The window-toggle nav pill keeps its own inline glass classes
 * — `Surface` always bakes in `rounded-2xl`, the pill wants `rounded-lg`, and refactoring it
 * risked a real class-collision bug for no benefit. `.kamby-void` still supplies the base
 * True-Deep-Black ground and monospace-friendly ink tokens everything here sits on.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { window?: string; chain?: string };
}) {
  const window: PnlWindow = isPnlWindow(searchParams.window) ? searchParams.window : '24h';
  const chain: LeaderboardChainFilter | null = isChainFilter(searchParams.chain) ? searchParams.chain : null;
  const leaderboard = await fetchLeaderboard(window, 25, chain);

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
                href={`/leaderboard?window=${w}${chain ? `&chain=${chain}` : ''}`}
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

        <nav className="mt-4 flex flex-wrap gap-1.5">
          {CHAIN_FILTERS.map((c) => (
            <Link
              key={c ?? 'all'}
              href={`/leaderboard?window=${window}${c ? `&chain=${c}` : ''}`}
              className={cn(
                'rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[0.65rem] font-medium uppercase tracking-wide transition-colors',
                c === chain ? 'bg-accent text-accent-ink' : 'bg-white/[0.03] text-ink-400 hover:text-ink-900',
              )}
            >
              {chainLabel(c)}
            </Link>
          ))}
        </nav>

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
              <li key={entry.userId}>
                <Surface variant="glass" className="flex items-center gap-4 p-4">
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
                </Surface>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
