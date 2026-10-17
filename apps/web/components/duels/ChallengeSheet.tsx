'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DUEL_LIMITS, type DmConversation, type DmPerson } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { challengeDuel } from '@/lib/duels-client';
import { friendlyError } from '@/lib/friendly-error';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { haptic } from '@/components/dm/DmMessageView';
import { Swords, VsChip } from './DuelBits';

/**
 * Throw down a duel from a chat (2026-10-17): pick who (a private chat: them; a group: one of its
 * people) and how long, read the three rules, send. The card lands in this chat.
 */
export function ChallengeSheet({ open, onClose, conv, onSent }: { open: boolean; onClose: () => void; conv: DmConversation; onSent: () => void }) {
  const t = useTranslations('duels');
  const people: DmPerson[] = conv.group ? conv.group.members.filter((p) => p.userId !== conv.meId && p.username) : conv.other?.username ? [conv.other] : [];
  const me = conv.group?.members.find((p) => p.userId === conv.meId) ?? null;
  const [who, setWho] = useState<DmPerson | null>(conv.group ? null : (people[0] ?? null));
  const [minutes, setMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!who?.username) return;
    setBusy(true);
    setError(null);
    try {
      await challengeDuel(who.username, minutes, conv.id);
      haptic(16);
      onSent();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('challengeTitle')} desktop>
      {/* Face-off */}
      <div className="flex items-center justify-center gap-4 rounded-3xl border border-white/[0.06] px-4 py-4" style={{ background: 'linear-gradient(135deg, rgba(0,255,135,0.10), #0B1024 40%, #0B1024 60%, rgba(0,229,255,0.10))' }}>
        <span className="flex flex-col items-center gap-1">
          <span className="relative">
            <DmAvatar name={me?.username ?? t('you')} src={me?.avatarUrl ?? null} className="h-14 w-14 text-base" />
            <span className="absolute -inset-[3px] rounded-full border-2 border-[#00FF87]" aria-hidden />
          </span>
          <span className="font-display text-xs font-bold text-ink-900">{t('you')}</span>
        </span>
        <VsChip className="h-11 w-11 text-sm" />
        <span className="flex flex-col items-center gap-1">
          <span className="relative">
            {who ? (
              <DmAvatar name={who.username} src={who.avatarUrl} className="h-14 w-14 text-base" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-white/20 font-display text-xl text-ink-400">?</span>
            )}
            <span className="absolute -inset-[3px] rounded-full border-2 border-[#00E5FF]" aria-hidden />
          </span>
          <span className="max-w-[6rem] truncate font-display text-xs font-bold text-ink-900">{who ? `@${who.username}` : t('pickRival')}</span>
        </span>
      </div>

      {conv.group && (
        <>
          <p className="mt-4 px-1 font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('rival')}</p>
          <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {people.map((p) => (
              <button
                key={p.userId}
                type="button"
                onClick={() => setWho(p)}
                className={cn('flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl py-2 transition-colors', who?.userId === p.userId ? 'bg-[#00E5FF]/10' : 'active:bg-white/[0.05]')}
              >
                <DmAvatar name={p.username} src={p.avatarUrl} className={cn('h-10 w-10 text-xs', who?.userId === p.userId && 'ring-2 ring-[#00E5FF]')} />
                <span className="w-full truncate px-1 text-center font-body text-[0.62rem] text-ink-600">@{p.username}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 px-1 font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('length')}</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {DUEL_LIMITS.minutes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMinutes(m)}
            className={cn(
              'rounded-2xl border py-3 font-display text-sm font-black tabular-nums transition-colors',
              minutes === m ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/[0.06] bg-white/[0.03] text-ink-900',
            )}
          >
            {t('minShort', { count: m })}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-1.5 rounded-2xl bg-white/[0.03] px-3.5 py-3 font-body text-[0.72rem] leading-snug text-ink-400">
        <li>• {t('rule1')}</li>
        <li>• {t('rule2')}</li>
        <li>• {t('rule3')}</li>
      </ul>
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
      <button
        type="button"
        disabled={busy || !who}
        onClick={() => void send()}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-display text-base font-black text-black transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        <Swords className="h-5 w-5" />
        {busy ? '…' : t('throwDown')}
      </button>
    </MobileDrawer>
  );
}
