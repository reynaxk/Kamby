'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchLatestActivity, subscribeToActivityStream, type RealtimeStatus } from '@/lib/social-client';
import { formatCompactUsd, truncateAddress } from '@/lib/format';

/**
 * Compact, terminal-styled live activity feed — reuses the same real, already-live SSE
 * infrastructure as the full ActivityFeed (see lib/social-client.ts and
 * docs/SOCIAL.md#realtime), just a denser row layout for a narrow sidebar slot instead of
 * ActivityCard's full padded card. No new backend — `GET /social/activity` and
 * `GET /social/activity/stream` already exist and are already public.
 *
 * Deliberately labeled by chain in the header: this feed is real, but real activity data
 * only exists for Base (EVM) swaps today (`SocialController.getActivity` hardcodes
 * `DEFAULT_CHAIN_ID` — see that file's own comment on why). Never presented as Solana
 * activity just because it's rendered next to a Solana trade panel.
 */
export function SocialFeed() {
  const [items, setItems] = useState<SocialActivity[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [pendingCount, setPendingCount] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestActivity({ limit: 15 })
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
    const unsubscribe = subscribeToActivityStream(
      () => setPendingCount((count) => count + 1),
      setStatus,
    );
    return unsubscribe;
  }, []);

  async function revealNew() {
    try {
      const page = await fetchLatestActivity({ limit: 15 });
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
          Live Activity <span className="normal-case text-ink-400/70">— Base network</span>
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

function SocialFeedRow({ activity }: { activity: SocialActivity }) {
  const isBuy = activity.action === 'BUY';
  const handle = activity.trader.displayName ?? (activity.trader.address ? truncateAddress(activity.trader.address) : 'Unknown');
  const traderHref = activity.trader.address ? `/trader/${activity.trader.address}` : null;

  return (
    <div className="flex items-center gap-2 border-b border-line/50 px-3 py-2 font-mono text-xs">
      <span className={cn('shrink-0 font-semibold uppercase', isBuy ? 'text-up' : 'text-down')}>{isBuy ? 'BUY' : 'SELL'}</span>
      {traderHref ? (
        <Link href={traderHref} className="min-w-0 flex-1 truncate text-ink-600 hover:text-accent">
          {handle}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-ink-600">{handle}</span>
      )}
      <span className="shrink-0 text-ink-900">{formatCompactUsd(activity.amountUsd)}</span>
      <span className="shrink-0 truncate text-ink-400">{activity.token.symbol ?? truncateAddress(activity.token.address)}</span>
      <a
        href={`https://basescan.org/tx/${activity.txHash}`}
        target="_blank"
        rel="noreferrer noopener"
        className="shrink-0 text-ink-400 hover:text-accent"
        title={activity.txHash}
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
