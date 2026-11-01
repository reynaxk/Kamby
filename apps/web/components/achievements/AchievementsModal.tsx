'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, MAX_SHOWCASE_TITLES, type AchievementCategory, type AchievementsDto } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { forgetTitle, saveTitles } from '@/lib/achievements-client';
import { friendlyError } from '@/lib/friendly-error';
import { AchievementCard } from './AchievementCard';

type Filter = 'all' | 'unlocked' | AchievementCategory;

/**
 * Every title in one sheet (2026-11-01): unlocked first, then the closest to unlocking. On your
 * own profile each unlocked card can be worn next to your name or pinned to your showcase (3).
 * Someone else's shows only what they've unlocked.
 */
export function AchievementsModal({
  data,
  own,
  username,
  onClose,
  onChange,
}: {
  data: AchievementsDto;
  own: boolean;
  username?: string | null;
  onClose: () => void;
  onChange?: (next: AchievementsDto) => void;
}) {
  const t = useTranslations('achievements');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const byId = useMemo(() => new Map(data.achievements.map((p) => [p.id, p])), [data]);
  const unlockedCount = data.achievements.filter((p) => p.unlocked).length;

  const list = useMemo(() => {
    const rows = ACHIEVEMENTS.filter((a) => (own ? true : byId.get(a.id)?.unlocked)).filter((a) =>
      filter === 'all' ? true : filter === 'unlocked' ? byId.get(a.id)?.unlocked : a.category === filter,
    );
    const score = (id: string, target: number) => {
      const p = byId.get(id);
      if (p?.unlocked) return 2;
      return p?.progress != null ? Math.min(1, p.progress / target) : 0;
    };
    return rows.sort((x, y) => score(y.id, y.target) - score(x.id, x.target));
  }, [byId, filter, own]);

  async function apply(input: { equippedTitleId?: string | null; showcaseTitleIds?: string[] }) {
    setBusy(true);
    setError(null);
    try {
      const next = await saveTitles(input);
      if (username) forgetTitle(username);
      onChange?.(next);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const chips: Filter[] = ['all', 'unlocked', ...ACHIEVEMENT_CATEGORIES];

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 md:items-center md:p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[#06070A] md:max-h-[86vh] md:max-w-5xl md:rounded-[28px]"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <p className="font-display text-lg font-black text-white">{t('title')}</p>
            <p className="font-mono text-xs text-white/45">{t('progressOf', { n: unlockedCount, total: ACHIEVEMENTS.length })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white/70 hover:bg-white/[0.1]">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-3 [scrollbar-width:none]">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 font-display text-xs font-bold transition-colors',
                filter === c ? 'bg-white text-black' : 'bg-white/[0.05] text-white/60 hover:text-white',
              )}
            >
              {c === 'all' ? t('all') : c === 'unlocked' ? t('unlocked') : t(`cat_${c}`)}
            </button>
          ))}
        </div>
        {error && <p className="px-5 pb-2 font-body text-xs text-down">{error}</p>}
        <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:grid-cols-3 lg:grid-cols-4">
          {list.length === 0 && <p className="col-span-full py-10 text-center font-body text-sm text-white/45">{t('none')}</p>}
          {list.map((a) => {
            const p = byId.get(a.id);
            const unlocked = !!p?.unlocked;
            const worn = data.equippedTitleId === a.id;
            const shown = data.showcaseTitleIds.includes(a.id);
            const full = data.showcaseTitleIds.length >= MAX_SHOWCASE_TITLES;
            return (
              <AchievementCard
                key={a.id}
                achievement={a}
                progress={p}
                isUnlocked={unlocked}
                action={
                  own && unlocked ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void apply({ equippedTitleId: worn ? null : a.id })}
                        className={cn('h-7 flex-1 rounded-lg font-display text-[0.7rem] font-bold disabled:opacity-50', worn ? 'bg-white text-black' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]')}
                      >
                        {worn ? t('wearing') : t('wear')}
                      </button>
                      <button
                        type="button"
                        disabled={busy || (!shown && full)}
                        onClick={() => void apply({ showcaseTitleIds: shown ? data.showcaseTitleIds.filter((x) => x !== a.id) : [...data.showcaseTitleIds, a.id] })}
                        className={cn('h-7 flex-1 rounded-lg font-display text-[0.7rem] font-bold disabled:opacity-40', shown ? 'bg-white/[0.16] text-white' : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12]')}
                      >
                        {shown ? t('pinned') : t('pin')}
                      </button>
                    </div>
                  ) : null
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
