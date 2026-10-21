'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { DUEL_LIMITS, type DuelLeader, type DuelState } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { fetchDuelLeaders, fetchOpenDuels, joinDuel, openDuel, useCountdown } from '@/lib/duels-client';
import { friendlyError } from '@/lib/friendly-error';
import { Swords } from './DuelBits';

const MEDAL = ['#F5C84B', '#C9D1DC', '#D08A57'];

/** One open duel in the lobby: who threw it down, how long it runs, and Join. */
function OpenRow({ duel, onJoin, busy }: { duel: DuelState; onJoin: (id: string) => void; busy: boolean }) {
  const t = useTranslations('duels');
  const { text } = useCountdown(duel.expiresAt);
  const mine = duel.meId !== null && duel.meId === duel.challenger.userId;
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <DmAvatar name={duel.challenger.username} src={duel.challenger.avatarUrl} className="h-10 w-10 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold text-ink-900">@{duel.challenger.username ?? '…'}</span>
        <span className="block font-body text-xs text-ink-400">
          {duel.challenger.wins > 0 ? t('winsBadge', { count: duel.challenger.wins }) : t('firstDuel')} · {t('expiresIn', { time: text })}
        </span>
      </span>
      <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 font-display text-xs font-bold text-ink-600">{t('minShort', { count: duel.minutes })}</span>
      {mine ? (
        <Link href={`/duels/${duel.id}`} className="shrink-0 rounded-full bg-white/[0.08] px-3.5 py-2 font-display text-xs font-bold text-ink-900">
          {t('you')}
        </Link>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onJoin(duel.id)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-3.5 py-2 font-display text-xs font-black text-black transition-transform active:scale-95 disabled:opacity-50"
        >
          <Swords className="h-3.5 w-3.5" />
          {t('join')}
        </button>
      )}
    </li>
  );
}

/**
 * The duel lobby (2026-10-18, owner's Trading Duels brief — the free version): start an open
 * duel anyone can join, take one that's waiting, and the month's top duelists with their streak.
 * No entry fee and no prize pool (owner's call: a paid version is regulated gambling).
 */
export function DuelLobby() {
  const t = useTranslations('duels');
  const tE = useTranslations('empty');
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const [open, setOpen] = useState<DuelState[] | null>(null);
  const [leaders, setLeaders] = useState<DuelLeader[] | null>(null);
  const [minutes, setMinutes] = useState<number>(DUEL_LIMITS.minutes[0]);
  const [busy, setBusy] = useState(false);
  // A failed load says so — never "no duels" when we simply couldn't ask (2026-10-21).
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchOpenDuels()
      .then((rows) => {
        setOpen(rows);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
    void fetchDuelLeaders()
      .then(setLeaders)
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(fn: () => Promise<DuelState>) {
    setBusy(true);
    setError(null);
    try {
      const duel = await fn();
      router.push(`/duels/${duel.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      {/* Start one */}
      <section className="rounded-3xl border border-white/[0.07] bg-surface p-4">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-900">
          <Swords className="h-4 w-4 text-accent" />
          {t('lobbyTitle')}
        </h2>
        <p className="mt-1 font-body text-sm text-ink-400">{t('lobbySub')}</p>
        <div className="mt-3 flex rounded-2xl bg-white/[0.04] p-1" role="radiogroup" aria-label={t('length')}>
          {DUEL_LIMITS.minutes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={minutes === m}
              onClick={() => setMinutes(m)}
              className={cn('flex-1 rounded-xl py-2 font-display text-sm font-bold transition-colors', minutes === m ? 'bg-white/10 text-ink-900' : 'text-ink-400')}
            >
              {t('minShort', { count: m })}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => (authenticated ? void run(() => openDuel(minutes)) : login())}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-display text-base font-black text-black transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Swords className="h-4 w-4" />
          {t('startOpen')}
        </button>
        {error && <p className="mt-2 text-center font-body text-xs font-semibold text-down">{error}</p>}
      </section>

      {/* Waiting to be taken */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
        {open === null && loadFailed ? (
          <p className="px-4 py-6 text-center font-body text-sm text-ink-400">{tE('tryAgain')}</p>
        ) : open === null ? (
          <div className="space-y-2 p-4" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <p className="px-4 py-6 text-center font-body text-sm text-ink-400">{t('noOpen')}</p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {open.map((d) => (
              <OpenRow key={d.id} duel={d} busy={busy} onJoin={(id) => (authenticated ? void run(() => joinDuel(id)) : login())} />
            ))}
          </ul>
        )}
      </section>

      {/* The month's best */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.07] bg-surface">
        <h2 className="px-4 pt-4 font-display text-sm font-bold text-ink-900">{t('topDuelists')}</h2>
        {leaders === null && loadFailed ? (
          <p className="px-4 pb-5 pt-3 font-body text-sm text-ink-400">{tE('tryAgain')}</p>
        ) : leaders === null ? (
          <div className="space-y-2 p-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : leaders.length === 0 ? (
          <p className="px-4 pb-5 pt-3 font-body text-sm text-ink-400">{t('noLeaders')}</p>
        ) : (
          <ol className="mt-1 divide-y divide-white/[0.05]">
            {leaders.map((l, i) => (
              <li key={l.userId} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold tabular-nums"
                  style={i < 3 ? { color: MEDAL[i], background: `${MEDAL[i]}26` } : { color: 'rgba(255,255,255,0.45)' }}
                >
                  {i + 1}
                </span>
                <DmAvatar name={l.username} src={l.avatarUrl} className="h-8 w-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold text-ink-900">@{l.username ?? '…'}</span>
                  <span className="block font-body text-xs text-ink-400">{t('record', { wins: l.wins, played: l.played })}</span>
                </span>
                {l.streak >= 2 && (
                  <span className="shrink-0 rounded-full bg-accent/[0.12] px-2 py-0.5 font-display text-[0.7rem] font-bold text-accent">🔥 {t('streak', { count: l.streak })}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="px-2 text-center font-body text-xs leading-snug text-ink-400">{t('freeNote')}</p>
    </div>
  );
}
