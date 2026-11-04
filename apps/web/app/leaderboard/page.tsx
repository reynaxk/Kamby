import Link from 'next/link';
import { LeaderboardChainMenu } from '@/components/discovery/LeaderboardChainMenu';
import { cn } from '@kamby/ui';
import { SUPPORTED_CHAIN_SLUGS, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PnlValue } from '@/components/social/PnlValue';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { formatCompactUsd } from '@/lib/format';
import { fetchLeaderboard } from '@/lib/social-api';
import { TrackFeed } from '@/components/track/TrackFeed';
import { getTranslations } from 'next-intl/server';
import { LeaderTabs } from '@/components/squads/LeaderTabs';

export const revalidate = 30;
export const metadata = { title: 'Leaderboard — Kamby' };

const WINDOWS: readonly PnlWindow[] = ['24h', '7d', '30d'];
const WINDOW_LABEL: Record<PnlWindow, string> = { '24h': '24H', '7d': '7D', '30d': '30D' };
/** Fewer ranked traders than this shows the "be the first" state instead of a near-empty table. */
const MIN_RANKED = 3;

function isPnlWindow(value: string | undefined): value is PnlWindow {
  return WINDOWS.includes(value as PnlWindow);
}

function isChainFilter(value: string | undefined): value is LeaderboardChainFilter {
  if (value === undefined) return false;
  return value === 'solana' || (SUPPORTED_CHAIN_SLUGS as readonly string[]).includes(value);
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
/** The top three are Kamby's own sea ranks instead of numbers (owner idea 2026-10-10) — the
 *  same whale/shark/fish the holders list uses. */
const TOP_RANKS = [
  { tier: 'whale', icon: '🐋', ring: 'bg-accent/15 ring-accent/60', text: 'text-accent' },
  { tier: 'shark', icon: '🦈', ring: 'bg-warn/15 ring-warn/50', text: 'text-warn' },
  { tier: 'fish', icon: '🐟', ring: 'bg-up/10 ring-up/40', text: 'text-up' },
] as const;
const PODIUM = ['#F2C46D', '#C4CAD4', '#E0A26B'];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { window?: string; chain?: string };
}) {
  const window: PnlWindow = isPnlWindow(searchParams.window) ? searchParams.window : '24h';
  const chain: LeaderboardChainFilter | null = isChainFilter(searchParams.chain) ? searchParams.chain : null;
  const leaderboard = await fetchLeaderboard(window, 25, chain);
  const t = await getTranslations('leaderboard');
  const tL = await getTranslations('labels');
  const tS = await getTranslations('squads');
  const tD = await getTranslations('duels');

  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* The chain pick sits beside the time range (2026-11-01 tidy pass) instead of on a row of its own. */}
          <div className="flex items-center gap-2">
          <LeaderboardChainMenu chain={chain} window={window} className="!px-0" />
          <nav className="inline-flex rounded-lg border border-white/[0.06] bg-white/[0.03] p-1 backdrop-blur-xl max-md:border-0 max-md:bg-transparent max-md:p-0">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/leaderboard?window=${w}${chain ? `&chain=${chain}` : ''}`}
                className={cn(
                  'rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors',
                  w === window ? 'bg-accent text-accent-ink max-md:bg-white/10 max-md:text-ink-900' : 'text-ink-400 hover:text-ink-900',
                )}
              >
                {WINDOW_LABEL[w]}
              </Link>
            ))}
          </nav>
          </div>
        </div>

        <LeaderTabs active="traders" traders={tS('traders')} squads={tS('squads')} duels={tD('tab')} />

        {leaderboard.entries.length < MIN_RANKED ? (
          // Too few traders to rank (2026-10-06: one test wallet at -$0.37 looked empty and off at
          // launch) — an invitation instead of a near-empty table.
          <>
          {/* 2026-10-30 owner ("too much unnecessary info"): one slim row, not a big empty card — the whales below are the content. */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87]" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
                <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
              </svg>
            </span>
            <h2 className="min-w-0 flex-1 font-display text-sm font-bold text-white">{t('beFirst')}</h2>
            <Link href="/explore" className="shrink-0 rounded-xl bg-accent px-4 py-2 font-display text-xs font-bold text-accent-ink active:scale-[0.98]">
              {t('goTrade')}
            </Link>
          </div>
          {/* Never an empty screen (2026-10-29): until the board fills, the whales trading right now. */}
          <TrackFeed />
          </>
        ) : (
          <>
          {/* The top three on a podium (2026-11-04 redesign), the rest as rows under it. */}
          <ol className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 max-md:mt-4">
            {leaderboard.entries.slice(0, 3).map((entry, index) => (
              <li key={entry.userId}>
                <Link
                  href={`/trader/${entry.walletAddress}`}
                  className="relative flex flex-col gap-4 overflow-hidden rounded-xl border border-line bg-[#0A0B0E] p-4 transition-colors hover:border-white/15"
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: PODIUM[index] }} />
                  <span aria-hidden className="absolute right-4 top-2 font-mono text-4xl font-semibold tracking-tighter opacity-[0.16]" style={{ color: PODIUM[index] }}>#{index + 1}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-base ring-1', TOP_RANKS[index]!.ring)} aria-hidden>{TOP_RANKS[index]!.icon}</span>
                    <span className={cn('text-[0.64rem] font-semibold uppercase tracking-wide', TOP_RANKS[index]!.text)}>{tL(`tier_${TOP_RANKS[index]!.tier}`)}</span>
                  </span>
                  <TraderIdentity address={entry.walletAddress} displayName={entry.username} avatarUrl={entry.avatarUrl} size="sm" />
                  <span className="flex items-end justify-between gap-2">
                    <PnlValue usd={entry.realizedPnlUsd} pct={entry.realizedPnlPct} />
                    <span className="font-mono text-[0.68rem] text-ink-400">{formatCompactUsd(entry.volumeUsd)} vol</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {leaderboard.entries.length > 3 && (
          <ol start={4} className="mt-3 overflow-hidden rounded-xl border border-line bg-[#0A0B0E]">
            {leaderboard.entries.slice(3).map((entry, i) => {
              const index = i + 3;
              return (
              <li key={entry.userId} className="border-b border-white/[0.04] last:border-0">
                <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.025] max-md:gap-3">
                  <span className="w-9 shrink-0 text-center font-mono text-[0.8rem] tabular-nums text-ink-400">#{index + 1}</span>
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
                </div>
              </li>
              );
            })}
          </ol>
          )}
          </>
        )}
      </main>
    </div>
  );
}
