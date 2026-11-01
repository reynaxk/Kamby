'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type AchievementsDto } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchMyAchievements, fetchUserAchievements } from '@/lib/achievements-client';
import { AchievementCard } from './AchievementCard';
import { AchievementsModal } from './AchievementsModal';
import { TitlePill } from './TitleBadge';

/**
 * The titles block on a profile (2026-11-01): the worn title, the 3 pinned ones, and a button to
 * every title. `own` reads your full progress (locked ones too); otherwise only `username`'s
 * unlocked titles. `?achievements=1` (the "title unlocked" notification) opens the sheet.
 */
export function AchievementsShowcase({ own, username, className }: { own: boolean; username?: string | null; className?: string }) {
  const t = useTranslations('achievements');
  const [data, setData] = useState<AchievementsDto | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    const load = own ? fetchMyAchievements() : username ? fetchUserAchievements(username) : Promise.resolve(null);
    load.then((d) => live && setData(d)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [own, username]);

  // Phones and computers each render their own copy of this block; only the visible one opens.
  useEffect(() => {
    if (!own || !data || !ref.current || ref.current.offsetParent === null) return;
    try {
      if (new URLSearchParams(window.location.search).get('achievements') === '1') setOpen(true);
    } catch {
      // Cosmetic only.
    }
  }, [own, data]);

  if (!data) return null;
  const unlocked = data.achievements.filter((p) => p.unlocked);
  if (!own && unlocked.length === 0) return null;
  const byId = new Map(data.achievements.map((p) => [p.id, p]));
  // Up to six: your pinned ones first, then your rarest others.
  const order = ['mythic', 'legendary', 'epic', 'rare', 'common'];
  const pinnedOwn = data.showcaseTitleIds;
  const rest = unlocked
    .filter((p) => !pinnedOwn.includes(p.id))
    .map((p) => ACHIEVEMENTS_BY_ID.get(p.id)!)
    .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity))
    .map((a) => a.id);
  const pinned = [...pinnedOwn, ...rest].slice(0, 6);

  return (
    <section ref={ref} className={cn('rounded-3xl border border-white/[0.07] bg-white/[0.02] p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-black text-white">{t('title')}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[0.7rem] text-white/45">
            {t('progressOf', { n: unlocked.length, total: ACHIEVEMENTS.length })}
            {data.equippedTitleId && (
              <>
                <span aria-hidden>·</span>
                <TitlePill id={data.equippedTitleId} />
              </>
            )}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full bg-white/[0.07] px-3.5 py-2 font-display text-xs font-bold text-white hover:bg-white/[0.12]">
          {t('seeAll')}
        </button>
      </div>
      {pinned.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {pinned.map((id) => {
            const a = ACHIEVEMENTS_BY_ID.get(id);
            return a ? <AchievementCard key={id} achievement={a} progress={byId.get(id)} isUnlocked compact /> : null;
          })}
        </div>
      ) : (
        <p className="mt-3 font-body text-sm text-white/50">{t('emptyOwn')}</p>
      )}
      {open && <AchievementsModal data={data} own={own} username={username} onClose={() => setOpen(false)} onChange={setData} />}
    </section>
  );
}
