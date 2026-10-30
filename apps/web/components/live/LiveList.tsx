'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LiveRoom } from '@kamby/domain';
import { formatCompactCount, formatRelativeTime } from '@/lib/format';
import { fetchLiveRooms } from '@/lib/live-engine';
import { hasStoredSession } from '@/lib/session-client';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { GoLiveSheet } from './GoLive';

/**
 * Every live stream as a card (2026-10-30 redesign, owner's concepts: "Live Now"). Refreshed
 * every half minute while the page is visible. `limit` shows the first few (the home column).
 */
export function LiveList({ limit, compact = false, strip = false }: { limit?: number; compact?: boolean; strip?: boolean }) {
  const t = useTranslations('live');
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [goLive, setGoLive] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(hasStoredSession());
    let cancelled = false;
    const load = () =>
      fetchLiveRooms()
        .then((r) => !cancelled && setRooms([...r].sort((a, b) => b.viewers - a.viewers)))
        .catch(() => !cancelled && setRooms((cur) => cur ?? []));
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const shown = rooms && limit ? rooms.slice(0, limit) : rooms;

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
              <LiveCard room={r} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (compact && shown && shown.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
        <p className="flex-1 font-body text-sm text-ink-600">{t('nobodyLive')}</p>
        {signedIn && (
          <button type="button" onClick={() => setGoLive(true)} className="h-9 shrink-0 rounded-xl bg-[#FF3B69] px-3.5 font-display text-xs font-black text-white">
            {t('goLive')}
          </button>
        )}
        <GoLiveSheet open={goLive} onClose={() => setGoLive(false)} />
      </div>
    );
  }

  return (
    <>
      {!compact && (
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
      )}
      {shown === null ? (
        <div className={compact ? 'h-56 animate-pulse rounded-2xl bg-surface' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
          {!compact && [0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-surface" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center">
          <p className="font-display text-lg font-bold text-ink-900">{t('nobodyLive')}</p>
          <p className="mt-1 font-body text-sm text-ink-600">{t('nobodyLiveHint')}</p>
        </div>
      ) : (
        <ul className={compact ? 'flex flex-col gap-3' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
          {shown.map((r) => (
            <li key={r.id}>
              <LiveCard room={r} />
            </li>
          ))}
        </ul>
      )}
      <GoLiveSheet open={goLive} onClose={() => setGoLive(false)} />
    </>
  );
}

function LiveCard({ room }: { room: LiveRoom }) {
  const t = useTranslations('live');
  return (
    <Link href={`/live/${room.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-white/15">
      {/* No video until you open it — a stage with the host and what they trade. */}
      <div className="relative flex h-36 items-center justify-center border-b border-line bg-[#040507]">
        <DmAvatar name={room.host.username} src={room.host.avatarUrl} className="h-16 w-16 text-xl" />
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
          <span className="rounded-[5px] bg-[#FF3B69] px-1.5 py-0.5 font-display text-[0.6rem] font-black tracking-wider text-white">LIVE</span>
          <span className="rounded-[5px] bg-black/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-900">
            {t('watching', { count: formatCompactCount(room.viewers) })}
          </span>
        </div>
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
          <p className="truncate font-body text-xs text-ink-600">
            @{room.host.username} · {formatRelativeTime(room.startedAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-xl bg-accent px-3 py-2 font-display text-xs font-black text-black">{t('join')}</span>
      </div>
    </Link>
  );
}
