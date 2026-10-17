'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { DUEL_LIMITS, type DuelSide, type DuelState } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { acceptDuel, cheerDuel, declineDuel, useCountdown, useDuel } from '@/lib/duels-client';
import { friendlyError } from '@/lib/friendly-error';
import { cashtag, formatCompactUsd, formatRelativeTime } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { haptic } from '@/components/dm/DmMessageView';
import { PnlGauge, SIDE_COLOR, Swords, VsChip } from './DuelBits';

type SideKey = 'challenger' | 'opponent';

interface Floater {
  id: number;
  emoji: string;
  side: SideKey;
  x: number;
}

/** The round clock: a ring that empties as the duel runs out. */
function Clock({ duel }: { duel: DuelState }) {
  const t = useTranslations('duels');
  const live = duel.status === 'live';
  const { text, leftMs } = useCountdown(live ? duel.endsAt : null);
  const total = duel.minutes * 60_000;
  const frac = live ? Math.max(0, Math.min(1, leftMs / total)) : duel.status === 'done' ? 0 : 1;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-28 w-28">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#kamby-duel-clock)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
        <defs>
          <linearGradient id="kamby-duel-clock" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={SIDE_COLOR.challenger} />
            <stop offset="100%" stopColor={SIDE_COLOR.opponent} />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        {live ? (
          <>
            <span className="font-display text-2xl font-black tabular-nums tracking-tight text-white">{text}</span>
            <span className="flex items-center gap-1 font-body text-[0.58rem] font-bold uppercase tracking-[0.16em] text-down">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-down" />
              {t('live')}
            </span>
          </>
        ) : duel.status === 'done' ? (
          <span className="font-display text-sm font-black uppercase tracking-[0.14em] text-white">{t('final')}</span>
        ) : (
          <span className="font-display text-sm font-black text-white">{t('minShort', { count: duel.minutes })}</span>
        )}
      </span>
    </div>
  );
}

function Corner({ side, which, duel, onCheer, canCheer, floaters }: { side: DuelSide; which: SideKey; duel: DuelState; onCheer: (s: SideKey, e: string) => void; canCheer: boolean; floaters: Floater[] }) {
  const t = useTranslations('duels');
  const color = SIDE_COLOR[which];
  const winner = duel.status === 'done' && duel.winnerId === side.userId;
  const cheers = duel.reactions[which];
  const total = Object.values(cheers).reduce((a, b) => a + b, 0);
  return (
    <div className={cn('relative flex min-w-0 flex-col items-center overflow-hidden rounded-[1.75rem] border px-2.5 pb-3 pt-4', winner ? 'border-[#F5C451]/50' : 'border-white/[0.07]')} style={{ background: `linear-gradient(180deg, ${color}14 0%, rgba(9,12,26,0.92) 46%)` }}>
      {/* Cheers float up from this corner */}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 top-0" aria-hidden>
        {floaters
          .filter((f) => f.side === which)
          .map((f) => (
            <span key={f.id} className="kamby-cheer-float absolute bottom-0 text-2xl" style={{ left: `${f.x}%` }}>
              {f.emoji}
            </span>
          ))}
      </div>
      <span className="relative">
        <DmAvatar name={side.username} src={side.avatarUrl} className="h-16 w-16 text-lg" />
        <span className="absolute -inset-[3px] rounded-full" style={{ border: `2px solid ${color}` }} aria-hidden />
        {winner && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-xl" aria-hidden>👑</span>}
      </span>
      <span className="mt-2 w-full truncate text-center font-display text-sm font-black text-white">@{side.username ?? '…'}</span>
      <span className="font-body text-[0.62rem] text-white/45">{side.wins > 0 ? t('winsBadge', { count: side.wins }) : t('firstDuel')}</span>
      <div className="mt-3">
        <PnlGauge pct={side.pct} color={color} size={128} />
      </div>
      <span className="mt-1 font-body text-[0.62rem] text-white/45">{side.investedUsd > 0 ? t('in', { amount: formatCompactUsd(side.investedUsd) }) : t('noTradesYet')}</span>

      {/* Their trades in the duel */}
      <ul className="mt-3 w-full space-y-1">
        {side.trades.slice(0, 4).map((tr) => {
          const href = marketHref(tr.chainIdentifier, tr.tokenAddress);
          const row = (
            <span className="flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-2 py-1.5">
              <TokenAvatar src={tr.logoUrl} seed={tr.tokenAddress} label={tr.symbol ?? '?'} className="h-5 w-5 text-[0.5rem]" />
              <span className="min-w-0 flex-1 truncate font-display text-[0.7rem] font-bold text-white">{cashtag(tr.symbol ?? '?')}</span>
              <span className="font-body text-[0.62rem] tabular-nums text-white/60">{formatCompactUsd(tr.amountUsd)}</span>
            </span>
          );
          return <li key={`${tr.tokenAddress}:${tr.at}`}>{href ? <Link href={href}>{row}</Link> : row}</li>;
        })}
        {side.trades.length > 4 && <li className="text-center font-body text-[0.6rem] text-white/40">+{side.trades.length - 4}</li>}
      </ul>

      {/* Cheer this corner */}
      {canCheer && (
        <div className="mt-3 grid w-full grid-cols-3 gap-1">
          {DUEL_LIMITS.reactions.map((e) => (
            <button key={e} type="button" onClick={() => onCheer(which, e)} className="relative rounded-xl bg-white/[0.05] py-1.5 text-lg transition-transform active:scale-90" aria-label={t('cheerWith', { emoji: e })}>
              {e}
              {cheers[e] ? <span className="absolute -right-0.5 -top-1 rounded-full bg-black/70 px-1 font-body text-[0.5rem] font-bold text-white/80">{cheers[e]}</span> : null}
            </button>
          ))}
        </div>
      )}
      {!canCheer && total > 0 && <span className="mt-3 font-body text-[0.65rem] text-white/50">{t('cheersCount', { count: total })}</span>}
    </div>
  );
}

/**
 * The ⚔️ arena (2026-10-17): the clock in the middle, each duelist's corner with their live %
 * PnL gauge, their trades in the duel, and the crowd's cheers — tap an emoji to cheer a side and
 * watch it float up. Open to anyone with the link; Cheer needs to be signed in.
 */
export function DuelArena({ id }: { id: string }) {
  const t = useTranslations('duels');
  const router = useRouter();
  const { authenticated } = usePrivy();
  const [duel, setDuel, loadError] = useDuel(id);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<Record<SideKey, Record<string, number>> | null>(null);
  const seq = useRef(0);

  // New cheers from anyone → a few emojis float up from that corner.
  useEffect(() => {
    if (!duel) return;
    const prev = last.current;
    last.current = duel.reactions;
    if (!prev) return;
    const spawn: Floater[] = [];
    for (const side of ['challenger', 'opponent'] as const) {
      for (const [emoji, n] of Object.entries(duel.reactions[side])) {
        const more = Math.min(4, n - (prev[side][emoji] ?? 0));
        for (let i = 0; i < more; i++) spawn.push({ id: seq.current++, emoji, side, x: 15 + Math.random() * 70 });
      }
    }
    if (spawn.length) float(spawn);
  }, [duel]);

  function float(list: Floater[]) {
    setFloaters((f) => [...f, ...list].slice(-24));
    setTimeout(() => setFloaters((f) => f.filter((x) => !list.includes(x))), 1800);
  }

  async function cheer(side: SideKey, emoji: string) {
    haptic(6);
    float([{ id: seq.current++, emoji, side, x: 20 + Math.random() * 60 }]);
    const counts = await cheerDuel(id, side, emoji).catch(() => null);
    if (counts && duel) {
      last.current = { ...(last.current ?? duel.reactions), [side]: counts };
      setDuel({ ...duel, reactions: { ...duel.reactions, [side]: counts } });
    }
  }

  async function act(fn: (id: string) => Promise<DuelState>) {
    setBusy(true);
    setError(null);
    try {
      setDuel(await fn(id));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!duel) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-6 text-center font-body text-sm text-white/50">{loadError ? t('notFound') : <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-accent" />}</div>
    );
  }

  const isDuelist = duel.meId === duel.challenger.userId || duel.meId === duel.opponent.userId;
  const canCheer = authenticated && duel.status === 'live';
  const winner = duel.winnerId ? (duel.winnerId === duel.challenger.userId ? duel.challenger : duel.opponent) : null;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#05070A] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(34rem_22rem_at_0%_0%,rgba(0,255,135,0.10),transparent_60%),radial-gradient(34rem_22rem_at_100%_0%,rgba(0,229,255,0.10),transparent_60%)]" />

      <header className="relative z-10 flex items-center gap-2 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
        <button type="button" aria-label={t('back')} onClick={() => (window.history.length > 1 ? router.back() : router.push('/messages'))} className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 active:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="flex flex-1 items-center gap-1.5 font-display text-sm font-black uppercase tracking-[0.16em]">
          <Swords className="h-4 w-4 text-accent" />
          {t('arena')}
        </span>
        {duel.conversationId && (
          <Link href={`/messages/${duel.conversationId}`} className="rounded-full bg-white/[0.08] px-3 py-1.5 font-display text-xs font-bold text-white">
            {t('cheerInChat')}
          </Link>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-3">
        <Clock duel={duel} />
        {winner && (
          <p className="kamby-pop mt-2 text-center font-display text-lg font-black">
            <span className="bg-[linear-gradient(150deg,#FFF1B8,#F5C451_45%,#B07A1E)] bg-clip-text text-transparent">{t('won', { name: `@${winner.username ?? '…'}` })}</span>
          </p>
        )}
        {duel.status === 'done' && !winner && <p className="mt-2 text-center font-display text-lg font-black text-white/80">{t('draw')}</p>}

        <div className="relative mt-4 grid grid-cols-2 gap-2.5">
          <Corner side={duel.challenger} which="challenger" duel={duel} onCheer={(s, e) => void cheer(s, e)} canCheer={canCheer} floaters={floaters} />
          <Corner side={duel.opponent} which="opponent" duel={duel} onCheer={(s, e) => void cheer(s, e)} canCheer={canCheer} floaters={floaters} />
          <span className="pointer-events-none absolute left-1/2 top-[5.25rem] -translate-x-1/2">
            <VsChip className="h-10 w-10 text-xs" />
          </span>
        </div>

        {/* Pending: the challenged trader answers here too */}
        {duel.status === 'pending' && (
          <div className="mt-4 rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4 text-center">
            <p className="font-body text-sm text-white/70">{t('pendingNote', { name: `@${duel.opponent.username ?? '…'}` })}</p>
            {duel.meId === duel.opponent.userId && (
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void act(declineDuel)} className="flex-1 rounded-2xl bg-white/[0.08] py-3 font-display text-sm font-bold disabled:opacity-50">
                  {t('decline')}
                </button>
                <button type="button" disabled={busy} onClick={() => void act(acceptDuel)} className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-accent py-3 font-display text-sm font-black text-black disabled:opacity-50">
                  <Swords className="h-4 w-4" />
                  {t('accept')}
                </button>
              </div>
            )}
          </div>
        )}
        {duel.status === 'live' && isDuelist && (
          <Link href="/home" className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-display text-base font-black text-black transition-transform active:scale-[0.98]">
            {t('goTrade')}
          </Link>
        )}
        {error && <p className="mt-3 text-center font-body text-xs font-semibold text-down">{error}</p>}
        <p className="mt-5 text-center font-body text-[0.68rem] leading-snug text-white/40">
          {t('howScored')} · {duel.startedAt ? formatRelativeTime(duel.startedAt) : t('minShort', { count: duel.minutes })}
        </p>
      </main>
    </div>
  );
}
