'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SocialActivity } from '@kamby/domain';
import { useAccount } from 'wagmi';
import { checkFollowStatus } from '@/lib/social-client';

const MIN_SIZE_OPTIONS = [0, 1_000, 5_000, 10_000] as const;

/**
 * Drives the chart's "My swaps / Friends only / Min size" overlay controls — the same
 * filter row fomo.family-style terminals show above their chart. Filters the trade markers
 * KambyChart already renders (chartTraderMarkers.ts), never a separate fetch: all three
 * checkboxes narrow the same bounded `trades` array (TokenTraderConnection.
 * recentLargeTrades) the caller already has, entirely client-side.
 *
 * "Friends only" resolves follow status per unique trader address in the current trade list
 * (checkFollowStatus, reused as-is from social-client.ts) rather than needing a new "list
 * my follows" endpoint — the trade list is already small/bounded (large trades only), so
 * this stays a handful of requests, not N+1 over a real dataset. Resolved lazily, only once
 * the checkbox is actually turned on.
 *
 * Semantics: Min size is a hard floor, always applied. Unchecking "My swaps" hides your own
 * trades specifically. Checking "Friends only" narrows to followed traders — plus your own
 * trades too, unless you've also unchecked "My swaps" — treating "friends" as inclusive of
 * yourself felt like the least surprising reading of an ambiguous reference screenshot.
 */
export function useChartOverlayFilter(trades: SocialActivity[]): [SocialActivity[], JSX.Element] {
  const { address: myAddress } = useAccount();
  const [showMySwaps, setShowMySwaps] = useState(true);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [minSizeUsd, setMinSizeUsd] = useState<number>(0);
  const [friendAddresses, setFriendAddresses] = useState<Set<string>>(new Set());

  const uniqueTraderAddresses = useMemo(
    () => [...new Set(trades.map((t) => t.trader.address).filter((a): a is string => a !== null))],
    [trades],
  );

  useEffect(() => {
    if (!friendsOnly || uniqueTraderAddresses.length === 0) return;
    let cancelled = false;
    Promise.all(uniqueTraderAddresses.map(async (addr) => [addr, await checkFollowStatus(addr)] as const)).then((results) => {
      if (cancelled) return;
      setFriendAddresses(new Set(results.filter(([, following]) => following).map(([addr]) => addr)));
    });
    return () => {
      cancelled = true;
    };
  }, [friendsOnly, uniqueTraderAddresses]);

  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (trade.amountUsd < minSizeUsd) return false;
      const isMine = !!myAddress && trade.trader.address?.toLowerCase() === myAddress.toLowerCase();
      if (isMine && !showMySwaps) return false;
      if (friendsOnly && !isMine && !(trade.trader.address && friendAddresses.has(trade.trader.address))) return false;
      return true;
    });
  }, [trades, minSizeUsd, showMySwaps, friendsOnly, friendAddresses, myAddress]);

  const controls = (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.65rem] text-ink-400">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={showMySwaps}
          onChange={(e) => setShowMySwaps(e.target.checked)}
          className="h-3 w-3 accent-accent"
        />
        My swaps
      </label>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={friendsOnly}
          onChange={(e) => setFriendsOnly(e.target.checked)}
          className="h-3 w-3 accent-accent"
        />
        Friends only
      </label>
      <label className="flex items-center gap-1.5">
        Min size
        <select
          value={minSizeUsd}
          onChange={(e) => setMinSizeUsd(Number(e.target.value))}
          className="rounded border border-line bg-surface-raised px-1 py-0.5 text-ink-900"
        >
          {MIN_SIZE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Any' : `>$${v.toLocaleString('en-US')}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return [filteredTrades, controls];
}
