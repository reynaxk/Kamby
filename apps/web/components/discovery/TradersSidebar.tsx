'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TopTrader } from '@kamby/domain';
import { formatCompactUsd } from '@/lib/format';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { fetchTopTraders } from '@/lib/social-client';

/**
 * A general trader directory for the terminal's left rail — volume-ranked (GET
 * /social/traders/top), deliberately distinct from the "Ranks" tab's PnL-ranked
 * leaderboard: this is "who's most active," not "who's most profitable." Same self-
 * contained, own-rounded-2xl-border pattern as LeaderboardSidebar/TrenchesPanel.
 */
export function TradersSidebar() {
  const [traders, setTraders] = useState<TopTrader[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetchTopTraders(20)
      .then((result) => {
        if (cancelled) return;
        setTraders(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-3 py-2.5">
        <span className="font-display text-[0.65rem] font-bold uppercase tracking-wide text-ink-400">
          Most active by volume
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && <p className="p-3 font-body text-xs text-ink-400">Loading…</p>}
        {status === 'error' && <p className="p-3 font-body text-xs text-down">Couldn&apos;t load traders.</p>}
        {status === 'ready' && traders?.length === 0 && (
          <p className="p-3 font-body text-xs text-ink-400">No trader has cleared the activity floor yet.</p>
        )}
        {status === 'ready' &&
          traders?.map((trader) => (
            <Link
              key={trader.address}
              href={`/trader/${trader.address}`}
              className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5 transition-colors hover:bg-surface-raised"
            >
              <div className="min-w-0 flex-1">
                <TraderIdentity address={trader.address} displayName={trader.username} avatarUrl={trader.avatarUrl} size="sm" />
              </div>
              <div className="shrink-0 text-right font-mono text-xs">
                <div className="font-semibold text-ink-900">{formatCompactUsd(trader.volumeUsd)}</div>
                <div className="text-[0.6rem] text-ink-400">{trader.tradeCount} trades</div>
              </div>
            </Link>
          ))}
      </div>
    </div>
  );
}
