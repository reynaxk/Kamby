'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { SocialActivity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { usePrivy } from '@privy-io/react-auth';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { fetchLatestActivity, fetchLatestFollowingActivity, subscribeToActivityStream, type RealtimeStatus } from '@/lib/social-client';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatCompactUsd, formatRelativeTime, truncateAddress } from '@/lib/format';

type Tab = 'whales' | 'following';
const MIN_CHOICES = [100, 1_000, 10_000] as const;
/** Wrapped gas coins and dollars aren't "a coin someone aped" — the router legs of a swap. */
const PLUMBING = new Set(['WETH', 'WBNB', 'WSOL', 'SOL', 'ETH', 'BNB', 'USDC', 'USDT', 'USDG', 'DAI', 'USDC.E', 'USDBC']);

/** Exported for tests. The rows worth showing: real coins, at least `minUsd`, newest first, once. */
export function trackRows(items: SocialActivity[], minUsd: number): SocialActivity[] {
  const seen = new Set<string>();
  return items
    .filter((a) => a.amountUsd >= minUsd && !PLUMBING.has((a.token.symbol ?? '').toUpperCase()))
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/**
 * Track (2026-10-29, GMGN's Track, simpler): who is buying what, live. "Whales" is every big
 * trade on the coins Kamby follows, above the size you pick; "Following" is the traders you
 * follow. Each row: who, bought/sold, how much, which coin — tap the coin to trade it, the
 * trader to see their profile.
 */
export function TrackFeed() {
  const t = useTranslations('track');
  const { authenticated, login } = usePrivy();
  const [tab, setTab] = useState<Tab>('whales');
  const [minUsd, setMinUsd] = useState<number>(1_000);
  const [items, setItems] = useState<SocialActivity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [, setTick] = useState(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    if (tab === 'following' && !authenticated) {
      setItems([]);
      return;
    }
    loading.current = true;
    try {
      const page = tab === 'following' ? await fetchLatestFollowingActivity({ limit: 50 }) : await fetchLatestActivity({ limit: 100 });
      setItems(page.items);
      setFailed(false);
    } catch {
      setFailed(true);
      setItems((prev) => prev ?? []);
    } finally {
      loading.current = false;
    }
  }, [tab, authenticated]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  // New trades land as a ping; refetch at most every 3s so a busy market doesn't hammer the API.
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToActivityStream(() => {
      const wait = Math.max(0, 3_000 - (Date.now() - last));
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        void load();
      }, wait);
    }, setStatus);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  // "12s ago" keeps moving.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const rows = items ? trackRows(items, tab === 'whales' ? minUsd : 0) : null;

  return (
    <section className="mt-4">
      <div className="flex items-center gap-2">
        <div role="tablist" className="flex gap-5">
          {(['whales', 'following'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('relative pb-2 font-display text-[0.95rem] font-bold transition-colors', tab === id ? 'text-ink-900' : 'text-ink-400')}
            >
              {t(id)}
              {tab === id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5 pb-2 font-body text-xs font-semibold text-ink-400">
          <span className={cn('h-1.5 w-1.5 rounded-full', status === 'live' ? 'animate-pulse bg-up' : 'bg-ink-400')} aria-hidden />
          {status === 'live' ? t('live') : t('connecting')}
        </span>
      </div>

      {tab === 'whales' && (
        <div className="mt-2 flex items-center gap-1.5" role="group" aria-label={t('min')}>
          <span className="font-body text-xs font-semibold text-ink-400">{t('min')}</span>
          {MIN_CHOICES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={minUsd === v}
              onClick={() => setMinUsd(v)}
              className={cn(
                'h-8 rounded-xl border px-3 font-display text-xs font-bold tabular-nums transition-colors',
                minUsd === v ? 'border-accent/60 bg-accent/10 text-accent' : 'border-white/10 bg-white/[0.03] text-ink-900',
              )}
            >
              {formatCompactUsd(v).replace('.0K', 'K').replace('.00', '')}+
            </button>
          ))}
        </div>
      )}

      {rows === null ? (
        <ul className="mt-3 space-y-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-[4.25rem] rounded-2xl bg-white/[0.03]" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="font-body text-sm text-ink-400">{failed ? t('failed') : tab === 'following' ? t(authenticated ? 'emptyFollowing' : 'signInFollowing') : t('emptyWhales')}</p>
          {tab === 'following' && !authenticated && (
            <button type="button" onClick={() => login()} className="h-11 rounded-2xl bg-accent px-6 font-display text-sm font-bold text-black">
              {t('signIn')}
            </button>
          )}
          {tab === 'following' && authenticated && (
            <Link href="/leaderboard" className="h-11 rounded-2xl bg-white/[0.07] px-6 font-display text-sm font-bold leading-[2.75rem] text-ink-900">
              {t('findTraders')}
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-white/[0.05]">
          {rows.map((a) => (
            <TrackRow key={a.id} activity={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackRow({ activity: a }: { activity: SocialActivity }) {
  const t = useTranslations('track');
  const buy = a.action === 'BUY';
  const who = a.trader.displayName ? `@${a.trader.displayName}` : a.trader.address ? truncateAddress(a.trader.address) : t('someone');
  const coin = a.token.symbol ? cashtag(a.token.symbol) : truncateAddress(a.token.address);
  const coinHref = marketHref(a.chainIdentifier, a.token.address);
  const chain = badgeChainFor(a.chainIdentifier);
  const whale = a.amountUsd >= 10_000;

  return (
    <li className="flex items-center gap-3 py-3">
      {a.trader.address ? (
        <Link href={`/trader/${a.trader.address}`} className="shrink-0" aria-label={who}>
          <DmAvatar name={a.trader.displayName ?? a.trader.address} src={a.trader.avatarUrl} className="h-10 w-10 text-sm" />
        </Link>
      ) : (
        <DmAvatar name={who} src={null} className="h-10 w-10 shrink-0 text-sm" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-body text-[0.8rem] text-ink-400">
          {a.trader.address ? (
            <Link href={`/trader/${a.trader.address}`} className="truncate font-semibold text-ink-600">
              {who}
            </Link>
          ) : (
            <span className="truncate font-semibold text-ink-600">{who}</span>
          )}
          {whale && <span aria-hidden>🐋</span>}
          <span className="shrink-0">· {formatRelativeTime(a.timestamp)}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 font-display text-[0.95rem] font-bold text-ink-900">
          <span className={buy ? 'text-up' : 'text-down'}>{buy ? t('bought') : t('sold')}</span>
          {coinHref ? (
            <Link href={coinHref} className="flex min-w-0 items-center gap-1.5">
              <CoinMark activity={a} chain={chain} />
              <span className="truncate">{coin}</span>
            </Link>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <CoinMark activity={a} chain={chain} />
              <span className="truncate">{coin}</span>
            </span>
          )}
        </p>
      </div>
      <span className={cn('shrink-0 rounded-xl px-2.5 py-1.5 font-display text-sm font-black tabular-nums', buy ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>
        {buy ? '+' : '−'}
        {formatCompactUsd(a.amountUsd).replace('.0K', 'K')}
      </span>
    </li>
  );
}

function CoinMark({ activity: a, chain }: { activity: SocialActivity; chain: ReturnType<typeof badgeChainFor> }) {
  return (
    <span className="relative shrink-0">
      <TokenAvatar src={a.token.logoUrl} seed={a.token.address} label={a.token.symbol ?? a.token.name} className="h-5 w-5 text-[0.55rem]" />
      {chain && <ChainBadge chain={chain} className="!h-2.5 !w-2.5" />}
    </span>
  );
}
