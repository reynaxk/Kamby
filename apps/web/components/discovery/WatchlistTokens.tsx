'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import type { WatchedToken } from '@kamby/domain';
import { fetchWatchlist, hasStoredSession } from '@/lib/watchlist-client';
import { marketHref } from '@/lib/solana-links';
import { SelectableTokenRow } from './SelectableTokenRow';
import { ListSkeleton } from '@/components/market/ListSkeleton';

/**
 * Home's Watchlist tab on phones (2026-10-10, like fomo — it's their first tab): the coins
 * you starred, as the same rows as every other list. Signed out it says how to start one.
 */
export function WatchlistTokens() {
  const tU = useTranslations('ui');
  const tAuth = useTranslations('auth');
  const tL = useTranslations('labels');
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [items, setItems] = useState<WatchedToken[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    // Signed in but no verified session yet: nothing can be watched — the empty state, not a spinner.
    if (!hasStoredSession()) {
      setItems([]);
      return;
    }
    let cancelled = false;
    fetchWatchlist({ limit: 50 })
      .then((page) => !cancelled && setItems(page.items))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (ready && !authenticated) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <p className="font-body text-sm text-ink-400">{tL('watchlistSignedOut')}</p>
        <button type="button" onClick={() => login()} className="mt-4 rounded-2xl bg-accent px-6 py-3 font-display text-sm font-bold text-black">
          {tAuth('signIn')}
        </button>
      </div>
    );
  }
  if (failed) return <p className="p-4 font-body text-sm text-ink-400">{tU('couldnTLoadYourWatchlist_1f12')}</p>;
  if (items === null) return <ListSkeleton label={tU('loading_5f02')} />;
  if (items.length === 0) return <p className="px-4 py-10 text-center font-body text-sm text-ink-400">{tL('watchlistEmpty')}</p>;
  return (
    <>
      {items.map((m) => (
        <SelectableTokenRow
          key={`${m.chainIdentifier}:${m.tokenAddress}`}
          market={m}
          selected={false}
          onSelect={() => {
            const href = marketHref(m.chainIdentifier, m.tokenAddress);
            if (href) router.push(href);
          }}
        />
      ))}
    </>
  );
}
