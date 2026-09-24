'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CHAIN_REGISTRY, SUPPORTED_CHAIN_SLUGS, type Leaderboard, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { PnlValue } from '@/components/social/PnlValue';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { fetchLeaderboard } from '@/lib/social-client';

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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex border-b border-line">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindow(w)}
            className={cn(
              'flex-1 border-b-2 px-2 py-2.5 font-display text-[0.65rem] font-bold uppercase tracking-wide transition-colors',
              window === w ? 'border-accent text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-600',
            )}
          >
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
        {CHAIN_FILTERS.map((c) => (
          <button
            key={c ?? 'all'}
            type="button"
            onClick={() => setChain(c)}
            className={cn(
              'rounded-full px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide transition-colors',
              chain === c ? 'bg-accent/15 text-accent' : 'text-ink-400 hover:text-ink-900',
            )}
          >
            {chainLabel(c)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && <p className="p-3 font-body text-xs text-ink-400">Loading…</p>}
        {status === 'error' && <p className="p-3 font-body text-xs text-down">Couldn&apos;t load the leaderboard.</p>}
        {status === 'ready' && leaderboard?.entries.length === 0 && (
          <p className="p-3 font-body text-xs text-ink-400">No realized PnL yet in this window.</p>
        )}
        {status === 'ready' &&
          leaderboard?.entries.map((entry, index) => (
            <Link
              key={entry.userId}
              href={`/trader/${entry.walletAddress}`}
              className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5 transition-colors hover:bg-surface-raised"
            >
              <span className="w-5 shrink-0 text-center font-mono text-xs font-semibold tabular-nums text-ink-400">
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
