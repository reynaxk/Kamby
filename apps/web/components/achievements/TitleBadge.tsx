'use client';

import { ACHIEVEMENTS_BY_ID, type AchievementRarity } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useWornTitle } from '@/lib/achievements-client';

const STYLE: Record<AchievementRarity, string> = {
  common: 'border-slate-600/60 text-slate-300',
  rare: 'border-blue-500/70 text-blue-300',
  epic: 'border-purple-500/80 text-purple-300',
  legendary: 'border-amber-400/80 text-amber-300',
  mythic: 'border-amber-300 text-amber-200',
};

/** A title pill from its id — the one shown beside a name, or anywhere a title is named. */
export function TitlePill({ id, className }: { id: string | null | undefined; className?: string }) {
  const a = id ? ACHIEVEMENTS_BY_ID.get(id) : undefined;
  if (!a) return null;
  return (
    <span
      title={a.description}
      className={cn(
        'inline-flex max-w-[11rem] shrink-0 items-center truncate rounded-md border px-1.5 py-px align-middle font-display text-[0.62rem] font-bold leading-4',
        a.category === 'humorous' ? 'border-dashed border-red-500/70 text-orange-300' : STYLE[a.rarity],
        a.rarity === 'mythic' && a.category !== 'humorous' && 'kamby-mythic-text',
        className,
      )}
    >
      <span className="truncate">{a.name}</span>
    </span>
  );
}

/** The title someone wears, next to their username in chat, the Feed and leaderboards. */
export function TitleBadge({ username, className }: { username: string | null | undefined; className?: string }) {
  const id = useWornTitle(username);
  return <TitlePill id={id} className={className} />;
}
