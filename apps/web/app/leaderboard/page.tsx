import Link from 'next/link';
import { LeaderboardChainMenu } from '@/components/discovery/LeaderboardChainMenu';
import { cn, Surface } from '@kamby/ui';
import { SUPPORTED_CHAIN_SLUGS, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PnlValue } from '@/components/social/PnlValue';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { formatCompactUsd } from '@/lib/format';
import { fetchLeaderboard } from '@/lib/social-api';
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
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              {t('title')}
            </h1>
            <p className="mt-1 max-w-md font-mono text-xs text-ink-400 max-md:hidden">
              {t('subtitle')}
            </p>
          </div>
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

        <LeaderTabs active="traders" traders={tS('traders')} squads={tS('squads')} duels={tD('tab')} />

        <LeaderboardChainMenu chain={chain} window={window} />

        {leaderboard.entries.length < MIN_RANKED ? (
          // Too few traders to rank (2026-10-06: one test wallet at -$0.37 looked empty and off at
          // launch) — an invitation instead of a near-empty table.
          <div className="kamby-glass relative mt-10 flex flex-col items-center overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center">
            {/* The PnL cards' faint neon K (2026-10-15). */}
            <svg className="pointer-events-none absolute -right-16 -top-12" width="300" height="300" viewBox="0 0 512 512" aria-hidden="true">
              <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" opacity="0.06">
                <path d="M186 140 V372" />
                <path d="M200 268 L338 140" />
                <path d="M232 246 L346 372" />
              </g>
            </svg>
            <span className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87]" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
                <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
              </svg>
            </span>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-accent">{t('season')}</p>
            <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-white">{t('beFirst')}</h2>
            <p className="mt-2 max-w-sm font-body text-sm text-ink-400">{t('beFirstSub')}</p>
            <Link
              href="/terminal"
              className="mt-8 rounded-2xl bg-accent px-8 py-3.5 font-display text-sm font-bold text-accent-ink active:scale-[0.98]"
            >
              {t('goTrade')}
            </Link>
          </div>
        ) : (
          <ol className="mt-8 flex flex-col gap-2 max-md:mt-4 max-md:gap-0">
            {leaderboard.entries.map((entry, index) => (
              <li key={entry.userId}>
                <Surface variant="glass" className="flex items-center gap-4 p-4 max-md:gap-3 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:py-3 max-md:shadow-none max-md:backdrop-blur-none">
                  {index < 3 ? (
                    <span className="flex w-11 shrink-0 flex-col items-center gap-0.5" aria-label={`#${index + 1}`}>
                      <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-lg ring-1', TOP_RANKS[index]!.ring)}>{TOP_RANKS[index]!.icon}</span>
                      <span className={cn('font-display text-[0.6rem] font-bold uppercase tracking-wide', TOP_RANKS[index]!.text)}>{tL(`tier_${TOP_RANKS[index]!.tier}`)}</span>
                    </span>
                  ) : (
                    <span className="w-11 shrink-0 text-center font-mono text-sm font-semibold tabular-nums text-ink-400">#{index + 1}</span>
                  )}
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
