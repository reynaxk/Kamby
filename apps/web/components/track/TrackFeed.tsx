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
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { followTrader, unfollowTrader, fetchLatestActivity, fetchLatestFollowingActivity, subscribeToActivityStream, type RealtimeStatus } from '@/lib/social-client';
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
export function TrackFeed({ compact = false }: { compact?: boolean }) {
  // `compact` is the desktop home's side panel — only mounted (and only streaming) on wide screens.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!compact) return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [compact]);
  if (compact && !wide) return null;
  return (
    <QuickBuyProvider>
      <Feed compact={compact} />
    </QuickBuyProvider>
  );
}

const COMPACT_ROWS = 6;

function Feed({ compact }: { compact: boolean }) {
  const t = useTranslations('track');
  const { authenticated, login } = usePrivy();
  const [tab, setTab] = useState<Tab>('whales');
  const [minUsd, setMinUsd] = useState<number>(100);
  const [items, setItems] = useState<SocialActivity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [, setTick] = useState(0);
  const loading = useRef(false);
  // Traders followed from this screen (the feed carries no follow state; Following-tab rows are followed by definition).
  const [followed, setFollowed] = useState<Set<string>>(() => new Set());

  const toggleFollow = useCallback(
    async (address: string) => {
      if (!authenticated) return login();
      const next = !followed.has(address);
      const apply = (on: boolean) =>
        setFollowed((prev) => {
          const s = new Set(prev);
          if (on) s.add(address);
          else s.delete(address);
          return s;
        });
      apply(next);
      try {
        await (next ? followTrader(address) : unfollowTrader(address));
      } catch {
        apply(!next); // the server never confirmed it
      }
    },
    [authenticated, login, followed],
  );

  const load = useCallback(async () => {
    if (loading.current) return;
    if (tab === 'following' && !authenticated) {
      setItems([]);
      return;
    }
    loading.current = true;
    try {
      // The API serves at most 50 a page; whales take two, since most trades are small.
      const page = tab === 'following' ? await fetchLatestFollowingActivity({ limit: 50 }) : await fetchLatestActivity({ limit: 50 });
      const more = tab === 'whales' && page.nextCursor ? await fetchLatestActivity({ limit: 50, cursor: page.nextCursor }).catch(() => null) : null;
      const fresh = [...page.items, ...(more?.items ?? [])];
      // Whales pile up while you watch (the newest 100 trades are only seconds of a busy market);
      // trackRows drops repeats. Capped so a long session stays light.
      setItems((prev) => (tab === 'whales' && prev ? [...fresh, ...prev].slice(0, 600) : fresh));
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

  const all = items ? trackRows(items, tab === 'whales' ? minUsd : 0) : null;
  const rows = all && compact ? all.slice(0, COMPACT_ROWS) : all;

  if (compact)
    return (
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[0.95rem] font-bold text-ink-900">🐋 {t('whalesLive')}</h2>
          <span className={cn('h-1.5 w-1.5 rounded-full', status === 'live' ? 'animate-pulse bg-up' : 'bg-ink-400')} aria-hidden />
          <Link href="/leaderboard/track" className="ml-auto font-body text-xs font-semibold text-accent">
            {t('seeAll')} →
          </Link>
        </div>
        {rows === null ? (
          <ul className="mt-2 space-y-2" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="h-[3.75rem] rounded-2xl bg-white/[0.03]" />
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className="py-6 font-body text-xs text-ink-400">{failed ? t('failed') : t('emptyWhales')}</p>
        ) : (
          <ul className="mt-1 divide-y divide-white/[0.05]">
            {rows.map((a) => (
              <TrackRow key={a.id} activity={a} followed={!!a.trader.address && followed.has(a.trader.address)} onFollow={a.trader.address ? () => void toggleFollow(a.trader.address!) : undefined} />
            ))}
          </ul>
        )}
      </section>
    );

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
            <TrackRow
              key={a.id}
              activity={a}
              followed={tab === 'following' || (!!a.trader.address && followed.has(a.trader.address))}
              onFollow={tab === 'whales' && a.trader.address ? () => void toggleFollow(a.trader.address!) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackRow({ activity: a, followed, onFollow }: { activity: SocialActivity; followed: boolean; onFollow?: () => void }) {
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
        <span className="relative shrink-0">
          <Link href={`/trader/${a.trader.address}`} aria-label={who}>
            <DmAvatar name={a.trader.displayName ?? a.trader.address} src={a.trader.avatarUrl} className="h-10 w-10 text-sm" />
          </Link>
          {/* One tap to follow the whale that just moved — like a story avatar's "+". */}
          {onFollow && (
            <button
              type="button"
              onClick={onFollow}
              aria-pressed={followed}
              aria-label={followed ? t('unfollow') : t('follow')}
              className={cn(
                'absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-bg text-[0.7rem] font-black leading-none',
                followed ? 'bg-up text-black' : 'bg-accent text-black',
              )}
            >
              {followed ? '✓' : '+'}
            </button>
          )}
        </span>
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
      <QuickBuyButton chainIdentifier={a.chainIdentifier} address={a.token.address} label={coin} className="-ml-1" />
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
