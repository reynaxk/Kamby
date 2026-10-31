'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LiveRoom } from '@kamby/domain';
import { formatCompactCount } from '@/lib/format';
import { fetchLiveRooms } from '@/lib/live-engine';
import { useMediaQuery } from '@/lib/use-media';
import { DmAvatar } from '@/components/dm/DmAvatar';

/**
 * Who's live, in the desktop left menu (2026-10-31, like Twitch's sidebar): the five most watched
 * streams with their viewers. Only loads where the menu shows (lg up); nothing when nobody's live.
 */
export function SideNavLive() {
  const t = useTranslations('live');
  const wide = useMediaQuery('(min-width: 1024px)');
  const [rooms, setRooms] = useState<LiveRoom[]>([]);

  useEffect(() => {
    if (!wide) return;
    let cancelled = false;
    const load = () =>
      fetchLiveRooms()
        .then((r) => !cancelled && setRooms([...r].sort((a, b) => b.viewers - a.viewers).slice(0, 5)))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wide]);

  if (rooms.length === 0) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-1.5 flex items-center gap-1.5 px-3 font-display text-[0.65rem] font-black uppercase tracking-wider text-ink-400">
        <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B69]" aria-hidden />
        {t('liveNow')}
      </p>
      <ul className="flex flex-col">
        {rooms.map((r) => (
          <li key={r.id}>
            <Link href={`/live/${r.id}`} className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 hover:bg-surface">
              <span className="rounded-full p-[1.5px] ring-2 ring-[#FF3B69]">
                <DmAvatar name={r.host.username} src={r.host.avatarUrl} className="h-7 w-7 text-[0.6rem]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-xs font-bold text-ink-900">{r.host.username}</span>
                <span className="block truncate font-body text-[0.65rem] text-ink-400">{r.coin?.symbol ? `$${r.coin.symbol}` : r.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[0.65rem] text-ink-600">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B69]" aria-hidden />
                {formatCompactCount(r.viewers)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
