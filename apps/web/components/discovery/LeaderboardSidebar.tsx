'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CHAIN_REGISTRY, SUPPORTED_CHAIN_SLUGS, type Leaderboard, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { PnlValue } from '@/components/social/PnlValue';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { fetchLeaderboard } from '@/lib/social-client';
import { useTranslations } from 'next-intl';

const WINDOWS: readonly PnlWindow[] = ['24h', '7d', '30d'];
const WINDOW_LABEL: Record<PnlWindow, string> = { '24h': '24H', '7d': '7D', '30d': '30D' };

/** `null` first — "All" is the real default every viewer sees before choosing to narrow. */
const CHAIN_FILTERS: readonly (LeaderboardChainFilter | null)[] = [null, 'solana', ...SUPPORTED_CHAIN_SLUGS];

function chainLabel(chain: LeaderboardChainFilter | null): string {
  if (chain === null) return 'All';
  if (chain === 'solana') return 'Solana';
  return CHAIN_REGISTRY[chain].name;
}

/**
 * A compact rank/PnL list for the terminal's left rail — same realized-PnL data as the
 * standalone /leaderboard page (GET /social/leaderboard, see lib/social-api.ts's
 * fetchLeaderboard for the server-rendered version of this), just the client-fetched
 * counterpart so switching windows here doesn't navigate away from the terminal. Structured
 * like TrenchesPanel.tsx (own window sub-tabs, own rounded-2xl border/bg, no click-to-trade
 * — see DiscoverTokenList.tsx's own doc comment on why tabs like this aren't wrapped a
 * second time by the tab bar around them).
 */
export function LeaderboardSidebar() {
  const tU = useTranslations('ui');
  const [window, setWindow] = useState<PnlWindow>('24h');
  const [chain, setChain] = useState<LeaderboardChainFilter | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchLeaderboard(window, 15, chain)
      .then((result) => {
        if (cancelled) return;
        setLeaderboard(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [window, chain]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/[0.07] bg-surface max-md:mx-4">
      {/* Window: one segmented pill (2026-10-18 audit — the old full-width underline tabs and
          tiny uppercase mono chips looked like a debug panel next to the rest of Home). */}
      <div className="p-2.5 pb-0">
        <div className="flex rounded-2xl bg-white/[0.04] p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={window === w}
              onClick={() => setWindow(w)}
              className={cn(
                'flex-1 rounded-xl px-2 py-1.5 font-display text-xs font-bold transition-colors',
                window === w ? 'bg-white/10 text-ink-900' : 'text-ink-400 hover:text-ink-600',
              )}
            >
              {WINDOW_LABEL[w]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto border-b border-white/[0.06] px-2.5 py-2.5">
        {CHAIN_FILTERS.map((c) => {
          const badge = c === null ? null : badgeChainFor(c === 'solana' ? 'solana' : CHAIN_REGISTRY[c].identifier);
          return (
            <button
              key={c ?? 'all'}
              type="button"
              aria-pressed={chain === c}
              onClick={() => setChain(c)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-display text-xs font-semibold transition-colors',
                chain === c ? 'border-accent/50 bg-accent/[0.1] text-ink-900' : 'border-white/[0.06] text-ink-400 hover:text-ink-900',
              )}
            >
              {badge && (
                <span aria-hidden className="relative h-3.5 w-3.5 shrink-0">
                  <ChainBadge chain={badge} className="!static !h-3.5 !w-3.5 !ring-0" />
                </span>
              )}
              {chainLabel(c)}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && (
          <div role="status" className="divide-y divide-white/[0.04]">
            <span className="sr-only">{tU('loading_5f02')}</span>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} aria-hidden className="flex items-center gap-3 px-3 py-3">
                <span className="h-4 w-4 animate-pulse rounded bg-white/[0.06]" />
                <span className="h-8 w-8 animate-pulse rounded-full bg-white/[0.06]" />
                <span className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" />
                <span className="h-3 w-14 animate-pulse rounded bg-white/[0.06]" />
              </div>
            ))}
          </div>
        )}
        {status === 'error' && <p className="px-4 py-6 text-center font-body text-sm text-down">{tU('couldnTLoadTheLeaderboard_2afe')}</p>}
        {status === 'ready' && leaderboard?.entries.length === 0 && (
          <div className="flex flex-col items-center px-6 py-9 text-center">
            <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-ink-400">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
              </svg>
            </span>
            <p className="mt-3 font-body text-sm text-ink-400">{tU('noRealizedPnlYetIn_607b')}</p>
          </div>
        )}
        {status === 'ready' &&
          leaderboard?.entries.map((entry, index) => (
            <Link
              key={entry.userId}
              href={`/trader/${entry.walletAddress}`}
              className="flex items-center gap-2.5 border-b border-white/[0.04] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold tabular-nums',
                  index === 0 ? 'bg-[#F5C84B]/15 text-[#F5C84B]' : index === 1 ? 'bg-[#C9D1DC]/15 text-[#C9D1DC]' : index === 2 ? 'bg-[#D08A57]/15 text-[#D08A57]' : 'text-ink-400',
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <TraderIdentity address={entry.walletAddress} displayName={entry.username} avatarUrl={entry.avatarUrl} size="sm" />
              </div>
              <PnlValue usd={entry.realizedPnlUsd} pct={entry.realizedPnlPct} size="sm" className="shrink-0" />
            </Link>
          ))}
      </div>
    </div>
  );
}
