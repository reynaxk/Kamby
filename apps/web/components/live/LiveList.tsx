'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LiveRoom } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactCount } from '@/lib/format';
import { fetchLiveRooms, liveThumbUrl } from '@/lib/live-engine';
import { hasStoredSession } from '@/lib/session-client';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { SafeImg } from '@/components/social/SafeImg';
import { GoLiveSheet } from './GoLive';
import { markStep } from '@/lib/onboarding';

type Category = 'all' | 'solana' | 'base' | 'bnb' | 'robinhood' | 'talk';
type Sort = 'watched' | 'new';

/** Which chip a stream sits under — the coin it's about decides; no coin = Talk. */
function categoryOf(r: LiveRoom): Exclude<Category, 'all'> {
  const c = r.coin?.chainIdentifier;
  if (!c) return 'talk';
  if (c === 'solana') return 'solana';
  if (c === 'eip155:8453') return 'base';
  if (c === 'eip155:56') return 'bnb';
  if (c === 'eip155:4663') return 'robinhood';
  return 'talk';
}

/** "12m" / "1h 05m" since the stream started. */
function liveFor(startedAt: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Every live stream as a card (2026-10-30 redesign): a picture of the stage (the host's browser
 * sends a moderated frame every few minutes), category chips by the coin's chain, Most watched /
 * Newest, and how long each has been live. Refreshed every 20 s while visible. `strip` is the
 * home page's three-card row.
 */
export function LiveList({ limit, strip = false }: { limit?: number; strip?: boolean }) {
  const t = useTranslations('live');
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [goLive, setGoLive] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [cat, setCat] = useState<Category>('all');
  const [sort, setSort] = useState<Sort>('watched');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!strip) markStep('explored');
    setSignedIn(hasStoredSession());
    let cancelled = false;
    const load = () =>
      fetchLiveRooms()
        .then((r) => {
          if (cancelled) return;
          setRooms(r);
          setNow(Date.now());
        })
        .catch(() => !cancelled && setRooms((cur) => cur ?? []));
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Category, number> = { all: 0, solana: 0, base: 0, bnb: 0, robinhood: 0, talk: 0 };
    for (const r of rooms ?? []) {
      c.all += 1;
      c[categoryOf(r)] += 1;
    }
    return c;
  }, [rooms]);

  const shown = useMemo(() => {
    if (!rooms) return null;
    const list = rooms.filter((r) => cat === 'all' || categoryOf(r) === cat);
    list.sort((a, b) => (sort === 'watched' ? b.viewers - a.viewers : Date.parse(b.startedAt) - Date.parse(a.startedAt)));
    return limit ? list.slice(0, limit) : list;
  }, [rooms, cat, sort, limit]);

  // Home's Live Now strip: nothing at all while nobody is live.
  if (strip) {
    if (!shown || shown.length === 0) return null;
    return (
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
            <span className="h-2 w-2 rounded-full bg-[#FF3B69]" aria-hidden />
            {t('liveNow')}
          </h2>
          <Link href="/live" className="font-display text-xs font-bold text-accent">
            {t('seeAll')}
          </Link>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {shown.map((r) => (
            <li key={r.id}>
              <LiveCard room={r} now={now} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const cats: Category[] = ['all', 'solana', 'base', 'bnb', 'robinhood', 'talk'];
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        {/* Phones have the title in AppBackBar already. */}
        <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink-900 max-md:invisible">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF3B69]" aria-hidden />
          {t('liveNow')}
        </h1>
        {signedIn && (
          <button type="button" onClick={() => setGoLive(true)} className="h-10 rounded-xl bg-[#FF3B69] px-4 font-display text-sm font-black text-white active:scale-95">
            {t('goLive')}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] max-md:basis-full md:mx-0 md:px-0">
          {cats
            .filter((c) => c === 'all' || counts[c] > 0 || cat === c)
            .map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-display text-xs font-bold',
                  cat === c ? 'border-accent/40 bg-accent/[0.1] text-accent' : 'border-line bg-surface text-ink-600',
                )}
              >
                {t(`cat_${c}`)}
                <span className="font-mono text-[0.65rem] opacity-70">{counts[c]}</span>
              </button>
            ))}
        </div>
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {(['watched', 'new'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={cn('h-7 rounded-lg px-2.5 font-display text-xs font-bold', sort === k ? 'bg-white/[0.08] text-ink-900' : 'text-ink-400')}>
              {t(k === 'watched' ? 'sortWatched' : 'sortNew')}
            </button>
          ))}
        </div>
      </div>

      {shown === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-video animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-7 text-center">
          <p className="font-display text-lg font-bold text-ink-900">{t('nobodyLive')}</p>
          <p className="mt-1 font-body text-sm text-ink-600">{t('nobodyLiveHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r, i) => (
            // The most watched stream leads, big (2026-10-31, like Twitch / Kick front pages).
            <li key={r.id} className={i === 0 && shown.length >= 3 && sort === 'watched' ? 'sm:col-span-2 xl:row-span-2' : undefined}>
              <LiveCard room={r} now={now} />
            </li>
          ))}
        </ul>
      )}
      <GoLiveSheet open={goLive} onClose={() => setGoLive(false)} />
    </>
  );
}

function LiveCard({ room, now }: { room: LiveRoom; now: number }) {
  const t = useTranslations('live');
  const hasVideo = room.tracks.some((x) => x.kind === 'screen' || x.kind === 'camera');
  const stage = (
    <div className="flex h-full w-full items-center justify-center bg-[#040507]">
      <DmAvatar name={room.host.username} src={room.host.avatarUrl} className="h-16 w-16 text-xl" />
    </div>
  );
  return (
    <Link href={`/live/${room.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-white/15">
      <div className="relative aspect-video overflow-hidden border-b border-line">
        {hasVideo ? <SafeImg src={liveThumbUrl(room.id)} className="h-full w-full object-cover" fallback={stage} /> : stage}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
          <span className="rounded-[5px] bg-[#FF3B69] px-1.5 py-0.5 font-display text-[0.6rem] font-black tracking-wider text-white">LIVE</span>
          <span className="rounded-[5px] bg-black/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-900">{t('watching', { count: formatCompactCount(room.viewers) })}</span>
        </div>
        <span className="absolute right-2.5 top-2.5 rounded-[5px] bg-black/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-900">{liveFor(room.startedAt, now)}</span>
        {!hasVideo && <span className="absolute bottom-2.5 left-2.5 rounded-[5px] bg-black/80 px-1.5 py-0.5 font-display text-[0.6rem] font-bold text-ink-600">🎙️ {t('voiceOnly')}</span>}
        {room.coin && (
          <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-lg bg-black/80 py-1 pl-1 pr-2 font-display text-xs font-bold text-ink-900">
            <TokenAvatar src={room.coin.logoUrl} seed={room.coin.tokenAddress} label={room.coin.symbol} className="h-[18px] w-[18px] text-[0.55rem]" />
            {room.coin.symbol ? `$${room.coin.symbol}` : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 p-3.5">
        <DmAvatar name={room.host.username} src={room.host.avatarUrl} className="h-9 w-9 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-ink-900">{room.title}</p>
          <p className="truncate font-body text-xs text-ink-600">@{room.host.username}</p>
        </div>
        <span className="shrink-0 rounded-xl bg-accent px-3 py-2 font-display text-xs font-black text-black">{t('join')}</span>
      </div>
    </Link>
  );
}
