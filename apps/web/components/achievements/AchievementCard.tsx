'use client';

import { useTranslations } from 'next-intl';
import type { Achievement, AchievementProgressDto } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactCount, formatCompactUsd } from '@/lib/format';

/** Border per rarity (owner spec 2026-11-01) — borders and colour only, no icons and no glow. */
const BORDER: Record<Achievement['rarity'], string> = {
  common: 'border-slate-600/50',
  rare: 'border-blue-500/80',
  epic: 'border-purple-500',
  legendary: 'border-amber-400',
  mythic: 'border-transparent',
};
const TONE: Record<Achievement['rarity'], string> = {
  common: 'text-slate-300',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-amber-300',
  mythic: 'text-amber-200',
};

function amount(a: Achievement, n: number): string {
  return a.usd ? formatCompactUsd(n) : formatCompactCount(Math.floor(n));
}

/** The share line at the bottom: "Unlocked by 0.04% of traders (14)". */
export function scarcityLine(t: ReturnType<typeof useTranslations>, p: AchievementProgressDto | undefined): string {
  if (!p || p.unlockedCount === 0) return t('nobodyYet');
  const pct = p.unlockedPct >= 10 ? p.unlockedPct.toFixed(0) : p.unlockedPct >= 1 ? p.unlockedPct.toFixed(1) : p.unlockedPct.toFixed(2);
  return t('unlockedBy', { pct, count: p.unlockedCount });
}

/**
 * One title as a card (2026-11-01): name, category and how to get it, the progress toward it, and
 * how many traders have it. Rarity is the border — slate, blue, purple, gold, and an animated
 * gold-to-rainbow edge for mythic; humorous titles get a dashed red-orange one. A locked secret
 * title shows nothing but "???".
 */
export function AchievementCard({
  achievement: a,
  progress: p,
  isUnlocked,
  compact,
  action,
}: {
  achievement: Achievement;
  progress?: AchievementProgressDto;
  isUnlocked: boolean;
  compact?: boolean;
  /** Equip / showcase buttons on your own cards. */
  action?: React.ReactNode;
}) {
  const t = useTranslations('achievements');
  const hidden = a.secret && !isUnlocked;
  const humorous = a.category === 'humorous';
  const current = p?.progress ?? 0;
  const pct = Math.min(100, a.target > 0 ? (current / a.target) * 100 : 0);

  const body = (
    <div
      className={cn(
        'relative flex h-full flex-col rounded-2xl border bg-gradient-to-b from-white/[0.05] to-white/[0.015] p-3.5',
        humorous ? 'border-dashed border-red-500/70' : BORDER[a.rarity],
        a.rarity === 'mythic' && !humorous && 'border-0 bg-[#0B0B10]',
        !isUnlocked && 'bg-none bg-white/[0.02]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('min-w-0 font-display font-black leading-tight', compact ? 'text-sm' : 'text-[0.95rem]', isUnlocked ? 'text-white' : 'text-white/55')}>
          {hidden ? '???' : a.name}
        </p>
        <span className={cn('shrink-0 font-mono text-[0.58rem] font-bold uppercase tracking-wider', TONE[a.rarity])}>{t(`rarity_${a.rarity}`)}</span>
      </div>
      <p className="mt-0.5 font-mono text-[0.58rem] uppercase tracking-wider text-white/35">{t(`cat_${a.category}`)}</p>
      {!compact && (
        <p className="mt-2 font-body text-[0.78rem] leading-snug text-white/60">{hidden ? t('lockedSecret') : a.description}</p>
      )}

      {!isUnlocked && !compact && (
        <div className="mt-3">
          {hidden ? (
            <p className="font-mono text-[0.68rem] text-white/40">{t('progressHidden')}</p>
          ) : (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                <div className={cn('h-full rounded-full', humorous ? 'bg-orange-400' : 'bg-accent')} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 flex justify-between gap-2 font-mono text-[0.66rem] tabular-nums text-white/50">
                <span className="truncate">
                  {amount(a, current)} / {amount(a, a.target)} {a.usd ? '' : a.unit}
                </span>
                <span>{Math.floor(pct)}%</span>
              </p>
            </>
          )}
        </div>
      )}

      <div className="mt-auto pt-3">
        {action}
        <p className={cn('font-mono text-[0.6rem] text-white/35', action && 'mt-2')}>{scarcityLine(t, p)}</p>
      </div>
    </div>
  );

  // Mythic: the border is a slowly moving gold → rainbow gradient around the card.
  if (a.rarity === 'mythic' && !humorous) {
    return (
      <div className={cn('kamby-mythic h-full rounded-2xl p-[1.5px] ring-2 ring-amber-500/50 ring-offset-0', !isUnlocked && 'opacity-60')}>
        {body}
      </div>
    );
  }
  return body;
}
