'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DuelSide, DuelState } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { acceptDuel, cancelDuel, declineDuel, useCountdown, useDuel } from '@/lib/duels-client';
import { friendlyError } from '@/lib/friendly-error';
import { formatPercent } from '@/lib/format';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { haptic } from '@/components/dm/DmMessageView';
import { SIDE_COLOR, Swords, VsChip } from './DuelBits';

/** Only cards on screen keep polling the duel. */
function useOnScreen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setOn(Boolean(e?.isIntersecting)), { rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on];
}

function Fighter({ side, color, crown }: { side: DuelSide; color: string; crown: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <span className="relative">
        <DmAvatar name={side.username} src={side.avatarUrl} className="h-12 w-12 text-sm" />
        <span className="absolute -inset-[3px] rounded-full" style={{ border: `2px solid ${color}` }} aria-hidden />
        {crown && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-base" aria-hidden>👑</span>}
      </span>
      <span className="w-full truncate text-center font-display text-[0.78rem] font-bold text-ink-900">@{side.username ?? '…'}</span>
      {side.wins > 0 && <span className="font-body text-[0.58rem] font-semibold text-ink-400">🏆 {side.wins}</span>}
    </span>
  );
}

/**
 * A ⚔️ duel in a chat (2026-10-17): who vs who, then — pending: Accept / Decline (or Cancel and
 * the time left to answer); live: both % PnL and the clock, Watch the arena; done: the winner.
 */
export function DuelCard({ duelId, minutes }: { duelId: string; minutes: number }) {
  const t = useTranslations('duels');
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const [duel, setDuel] = useDuel(duelId, onScreen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expire = useCountdown(duel?.status === 'pending' ? duel.expiresAt : null);
  const clock = useCountdown(duel?.status === 'live' ? duel.endsAt : null);

  async function act(fn: (id: string) => Promise<DuelState>) {
    setBusy(true);
    setError(null);
    try {
      setDuel(await fn(duelId));
      haptic(12);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const me = duel?.meId ?? null;
  const challengerWon = duel?.status === 'done' && duel.winnerId === duel.challenger.userId;
  const opponentWon = duel?.status === 'done' && duel.winnerId === duel.opponent.userId;

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="relative w-[17.5rem] overflow-hidden rounded-3xl border border-white/10 p-3.5"
      style={{ background: 'linear-gradient(135deg, rgba(0,255,135,0.10) 0%, #0B1024 38%, #0B1024 62%, rgba(0,229,255,0.10) 100%)' }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-display text-[0.7rem] font-black uppercase tracking-[0.14em] text-ink-900">
          <Swords className="h-3.5 w-3.5 text-accent" />
          {t('duel')} · {t('minutes', { count: minutes })}
        </span>
        {duel?.status === 'live' && (
          <span className="flex items-center gap-1 rounded-full bg-down px-2 py-0.5 font-display text-[0.6rem] font-black text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {clock.text}
          </span>
        )}
      </div>

      {!duel ? (
        <div className="mt-3 h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <Fighter side={duel.challenger} color={SIDE_COLOR.challenger} crown={challengerWon} />
            <VsChip />
            <Fighter side={duel.opponent} color={SIDE_COLOR.opponent} crown={opponentWon} />
          </div>

          {(duel.status === 'live' || duel.status === 'done') && (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {[duel.challenger, duel.opponent].map((s, i) => (
                <span key={s.userId} className="rounded-2xl bg-white/[0.04] py-2 text-center">
                  <span
                    className={cn('block font-display text-lg font-black tabular-nums', s.pct === null ? 'text-ink-400' : s.pct < 0 && 'text-down')}
                    style={{ color: s.pct !== null && s.pct >= 0 ? (i === 0 ? SIDE_COLOR.challenger : SIDE_COLOR.opponent) : undefined }}
                  >
                    {s.pct === null ? '—' : formatPercent(s.pct)}
                  </span>
                  <span className="font-body text-[0.58rem] font-semibold uppercase tracking-wider text-ink-400">{s.pct === null ? t('noTrades') : t('trades', { count: s.trades.length })}</span>
                </span>
              ))}
            </div>
          )}

          {duel.status === 'pending' && (
            <p className="mt-3 text-center font-body text-[0.7rem] text-ink-400">
              {t('pendingNote', { name: `@${duel.opponent.username ?? '…'}` })} · <span className="tabular-nums">{expire.text}</span>
            </p>
          )}
          {duel.status === 'done' && (
            <p className="mt-2.5 text-center font-display text-sm font-black text-ink-900">
              {duel.winnerId ? t('won', { name: `@${(challengerWon ? duel.challenger : duel.opponent).username ?? '…'}` }) : t('draw')}
            </p>
          )}
          {(duel.status === 'declined' || duel.status === 'expired' || duel.status === 'cancelled') && (
            <p className="mt-3 text-center font-body text-xs text-ink-400">{t(`status_${duel.status}`)}</p>
          )}
          {error && <p className="mt-2 text-center font-body text-[0.7rem] font-semibold text-down">{error}</p>}

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            {duel.status === 'pending' && me === duel.opponent.userId && (
              <>
                <button type="button" disabled={busy} onClick={() => void act(declineDuel)} className="flex-1 rounded-2xl bg-white/[0.07] py-2.5 font-display text-sm font-bold text-ink-900 disabled:opacity-50">
                  {t('decline')}
                </button>
                <button type="button" disabled={busy} onClick={() => void act(acceptDuel)} className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-accent py-2.5 font-display text-sm font-black text-black transition-transform active:scale-[0.97] disabled:opacity-50">
                  <Swords className="h-4 w-4" />
                  {t('accept')}
                </button>
              </>
            )}
            {duel.status === 'pending' && me === duel.challenger.userId && (
              <button type="button" disabled={busy} onClick={() => void act(cancelDuel)} className="flex-1 rounded-2xl bg-white/[0.07] py-2.5 font-display text-sm font-bold text-ink-600 disabled:opacity-50">
                {t('cancel')}
              </button>
            )}
            {(duel.status === 'live' || duel.status === 'done') && (
              <Link href={`/duels/${duelId}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.08] py-2.5 font-display text-sm font-bold text-ink-900 transition-transform active:scale-[0.97]">
                {duel.status === 'live' ? t('watchArena') : t('seeArena')}
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
