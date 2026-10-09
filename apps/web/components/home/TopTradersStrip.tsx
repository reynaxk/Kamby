'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LeaderboardEntry } from '@kamby/domain';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatSignedCompactUsd } from '@/lib/format';
import { fetchLeaderboard } from '@/lib/social-client';

/**
 * "Top traders this week" — a swipeable row of this week's best traders by realized profit
 * (2026-10-09 app redesign). Each card opens the trader's profile. Hidden until someone has a
 * profitable week, so a new Kamby never shows an empty or negative strip.
 */
export function TopTradersStrip() {
  const t = useTranslations('home');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard('7d', 10)
      .then((board) => !cancelled && setEntries(board.entries.filter((e) => e.realizedPnlUsd > 0)))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!entries || entries.length === 0) return null;
  return (
    <section className="py-2">
      <p className="px-1 pb-2 font-display text-sm font-semibold text-ink-900">🏆 {t('topTraders')}</p>
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {entries.map((entry) => (
          <Link
            key={entry.userId}
            href={`/trader/${entry.walletAddress}`}
            className="w-40 shrink-0 snap-start rounded-2xl border border-line bg-surface p-3 transition-colors active:bg-surface-raised"
          >
            <div className="flex items-center gap-2">
              <TokenAvatar src={entry.avatarUrl} seed={entry.walletAddress} label={entry.username ?? entry.walletAddress} className="h-7 w-7 text-xs" />
              <span className="truncate font-display text-sm font-semibold text-ink-900">
                {entry.username ?? `${entry.walletAddress.slice(0, 4)}…${entry.walletAddress.slice(-4)}`}
              </span>
            </div>
            <p className="mt-2 font-mono text-base font-semibold tabular-nums text-up">{formatSignedCompactUsd(entry.realizedPnlUsd)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
