'use client';

import { useRouter } from 'next/navigation';
import type { LeaderboardChainFilter, PnlWindow } from '@kamby/domain';
import { ChainFilter, type ChainFilterValue } from './ChainFilter';

/** The leaderboard page's chain pick as the same tap-to-open list as Discover (2026-10-28,
 *  owner: no scrolling rows of chains). */
export function LeaderboardChainMenu({ chain, window }: { chain: LeaderboardChainFilter | null; window: PnlWindow }) {
  const router = useRouter();
  return (
    <ChainFilter
      value={(chain ?? 'all') as ChainFilterValue}
      onChange={(next) => router.push(`/leaderboard?window=${window}${next === 'all' ? '' : `&chain=${next}`}`)}
      className="mt-4 px-0 max-md:px-0"
    />
  );
}
