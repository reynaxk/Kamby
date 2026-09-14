'use client';

import { useEffect, useState } from 'react';
import type { SolanaSocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchLatestSolanaActivity, subscribeToSolanaActivityStream } from '@/lib/solana-social-client';
import type { RealtimeStatus } from '@/lib/social-client';
import { formatCompactUsd, truncateAddress } from '@/lib/format';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Compact, terminal-styled live activity feed for Kamby's own real Solana trades — see
 * lib/solana-social-client.ts and SocialController's own comments on the backend side. No
 * mock data: every row is a real, confirmed `SolanaTradeTransaction` (see
 * SolanaTransactionService#getGlobalFeed), never a random on-chain firehose — subscribing
 * to raw Jupiter program logs platform-wide would show anonymous Solana-wide activity
 * unrelated to Kamby users, not a "social" feed of this product's own traders, which is
 * why this deliberately reuses the same DB-backed, Kamby-scoped pattern the EVM activity
 * feed already established rather than a new on-chain-log subscription pipeline.
 *
 * No trader-profile link on the handle: `/trader/:address` (TraderService) is an EVM-only
 * system with no knowledge of Solana wallets — linking there would 404 or show wrong data,
 * so the wallet address renders as plain text until Solana has its own profile system.
 */
export function SocialFeed() {
  const [items, setItems] = useState<SolanaSocialActivity[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [pendingCount, setPendingCount] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestSolanaActivity({ limit: 15 })
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSolanaActivityStream(
      () => setPendingCount((count) => count + 1),
      setStatus,
    );
    return unsubscribe;
  }, []);

  async function revealNew() {
    try {
      const page = await fetchLatestSolanaActivity({ limit: 15 });
      setItems(page.items);
      setPendingCount(0);
    } catch {
      // Leave the pill showing — the next successful ping/refetch will still catch it up.
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="font-display text-xs font-bold uppercase tracking-wide text-ink-400">
          Live Activity <span className="normal-case text-ink-400/70">— Solana</span>
        </span>
        <RealtimeDot status={status} />
      </div>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={() => void revealNew()}
          className="flex items-center justify-center gap-1.5 border-b border-line bg-accent/10 py-1.5 font-mono text-xs font-semibold text-accent hover:bg-accent/20"
        >
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {pendingCount} new {pendingCount === 1 ? 'trade' : 'trades'}
        </button>
      )}

      <div className="flex-1 overflow-y-auto">
        {loadError && items.length === 0 && <p className="p-3 font-body text-xs text-ink-400">Couldn&apos;t load live activity.</p>}
        {!loadError && items.length === 0 && <p className="p-3 font-body text-xs text-ink-400">No recent activity yet.</p>}
        {items.map((activity) => (
          <SocialFeedRow key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  );
}

function tokenLabel(mint: string): string {
  return mint === WSOL_MINT ? 'SOL' : truncateAddress(mint);
}

function SocialFeedRow({ activity }: { activity: SolanaSocialActivity }) {
  const isBuy = activity.side === 'BUY';

  return (
    <div className="flex items-center gap-2 border-b border-line/50 px-3 py-2 font-mono text-xs">
      <span className={cn('shrink-0 font-semibold uppercase', isBuy ? 'text-up' : 'text-down')}>{isBuy ? 'BUY' : 'SELL'}</span>
      <span className="min-w-0 flex-1 truncate text-ink-600">{truncateAddress(activity.walletAddress)}</span>
      <span className="shrink-0 text-ink-900">{formatCompactUsd(activity.amountUsd)}</span>
      <span className="shrink-0 truncate text-ink-400">{tokenLabel(activity.tokenMint)}</span>
      <a
        href={`https://solscan.io/tx/${activity.signature}`}
        target="_blank"
        rel="noreferrer noopener"
        className="shrink-0 text-ink-400 hover:text-accent"
        title={activity.signature}
      >
        ↗
      </a>
    </div>
  );
}

function RealtimeDot({ status }: { status: RealtimeStatus }) {
  const color = status === 'live' ? 'bg-up' : status === 'reconnecting' ? 'bg-down' : 'bg-ink-400';
  return <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', status === 'connecting' && 'animate-pulse', color)} />;
}
