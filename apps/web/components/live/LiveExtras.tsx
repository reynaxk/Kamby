'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LIVE_POLL_LIMITS, LIVE_REACTIONS, LIVE_SLOW_OPTIONS, type LiveChatLine, type LivePoll, type LiveReaction, type LiveRoom, type LiveSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactCount } from '@/lib/format';
import { reactInLive, startLivePoll, voteLivePoll } from '@/lib/live-engine';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { FollowButton } from '@/components/social/FollowButton';
import { ShareButton } from '@/components/social/ShareButton';

/**
 * The professional-platform layer of a live room (2026-10-31, after Twitch / YouTube Live /
 * TikTok Live / Kick): floating reactions, a Super-Chat-style highlighted tip, the host's pinned
 * line, the stream's top tippers, slow mode, the stream info bar and the host's end summary.
 */

// --- Floating reactions (TikTok-style) -------------------------------------------------------

export type FloatingHandle = { add: (emoji: string) => void };

/** Emojis rising up the right edge of the stage — at most 24 in the air at once. */
export const FloatingReactions = forwardRef<FloatingHandle>(function FloatingReactions(_, ref) {
  const [items, setItems] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const next = useRef(0);
  useImperativeHandle(ref, () => ({
    add(emoji) {
      const id = next.current++;
      setItems((cur) => [...cur.slice(-23), { id, emoji, x: Math.random() * 40 }]);
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 2600);
    },
  }));
  return (
    <div className="pointer-events-none absolute bottom-10 right-3 z-20 h-2/3 w-16" aria-hidden>
      {items.map((i) => (
        <span key={i.id} className="kamby-float-up absolute bottom-0 text-2xl" style={{ right: `${i.x}%` }}>
          {i.emoji}
        </span>
      ))}
    </div>
  );
});

/** The six reaction buttons under the chat. Shows it at once for you; the server tells everyone. */
export function ReactionBar({ roomId, onLocal }: { roomId: string; onLocal: (emoji: LiveReaction) => void }) {
  const t = useTranslations('live');
  return (
    <div className="flex gap-1" role="group" aria-label={t('react')}>
      {LIVE_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => {
            onLocal(e);
            void reactInLive(roomId, e).catch(() => undefined);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-lg transition-transform active:scale-90"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// --- Over the chat: pinned line, highlighted tip, top tippers ---------------------------------

/** How long a tip stays highlighted (YouTube Super Chat): 30 s for $5, up to 2 minutes. */
export function tipHoldMs(usd: number): number {
  return Math.min(120_000, Math.max(30_000, usd * 6_000));
}

export function ChatTop({ room, tip, isHost, onUnpin }: { room: LiveRoom | null; tip: LiveChatLine | null; isHost: boolean; onUnpin: () => void }) {
  const t = useTranslations('live');
  const tippers = room?.topTippers ?? [];
  if (!room?.pinned && !tip && tippers.length === 0 && !room?.slowSec) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2">
      {tippers.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <span className="shrink-0 font-display text-[0.6rem] font-black uppercase tracking-wider text-[#FFC94D]">{t('topTippers')}</span>
          {tippers.map((p, i) => (
            <span key={p.username} className="flex shrink-0 items-center gap-1 rounded-full bg-[#FFB800]/10 py-0.5 pl-0.5 pr-2 font-display text-[0.65rem] font-bold text-[#FFD966]">
              <DmAvatar name={p.username} src={p.avatarUrl} className="h-4 w-4 text-[0.4rem]" />
              {['🥇', '🥈', '🥉'][i]} {p.username} · ${p.usd.toFixed(0)}
            </span>
          ))}
        </div>
      )}
      {tip && (
        <div className="rounded-xl bg-[#FFB800] px-3 py-2 text-black">
          <p className="font-display text-xs font-black">
            💸 @{tip.username} · ${(tip.amountUsd ?? 0).toFixed(2)}
          </p>
        </div>
      )}
      {room?.pinned && (
        <div className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2">
          <span className="font-display text-[0.6rem] font-black uppercase tracking-wider text-accent">📌</span>
          <p className="min-w-0 flex-1 font-body text-xs text-white/90">
            <b className="mr-1 font-display">@{room.pinned.username}</b>
            {room.pinned.body}
          </p>
          {isHost && (
            <button type="button" onClick={onUnpin} aria-label={t('unpin')} className="text-xs text-white/50">
              ✕
            </button>
          )}
        </div>
      )}
      {Boolean(room?.slowSec) && <p className="font-mono text-[0.6rem] text-white/45">🐢 {t('slowOn', { seconds: room!.slowSec! })}</p>}
    </div>
  );
}

/** The host's slow-mode switch: tap to step through the options. */
export function SlowButton({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const t = useTranslations('live');
  const i = LIVE_SLOW_OPTIONS.indexOf(seconds as (typeof LIVE_SLOW_OPTIONS)[number]);
  const nextSec = LIVE_SLOW_OPTIONS[(i + 1) % LIVE_SLOW_OPTIONS.length]!;
  return (
    <button
      type="button"
      onClick={() => onChange(nextSec)}
      aria-label={t('slowMode')}
      title={t('slowMode')}
      className={cn('flex h-11 shrink-0 items-center justify-center gap-1 rounded-full px-3 font-display text-xs font-bold', seconds ? 'bg-white text-black' : 'bg-white/[0.12] text-white')}
    >
      🐢{seconds ? ` ${seconds}s` : ''}
    </button>
  );
}

// --- Under the stage (desktop): who's streaming ----------------------------------------------

export function StreamInfo({ room, elapsed }: { room: LiveRoom; elapsed: string }) {
  const t = useTranslations('live');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#07080B] p-3">
      <DmAvatar name={room.host.username} src={room.host.avatarUrl} className="h-11 w-11 text-sm ring-2 ring-[#FF3B69] ring-offset-2 ring-offset-[#07080B]" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-extrabold text-white">{room.title}</p>
        <p className="truncate font-body text-xs text-white/55">
          {room.host.walletAddress ? (
            <Link href={`/trader/${room.host.walletAddress}`} className="font-bold text-white/80 hover:text-white">
              @{room.host.username}
            </Link>
          ) : (
            <>@{room.host.username}</>
          )}{' '}
          · {t('watching', { count: formatCompactCount(room.viewers) })} · {elapsed}
          {room.coin?.symbol ? ` · $${room.coin.symbol}` : ''}
        </p>
      </div>
      {room.host.walletAddress && <FollowButton address={room.host.walletAddress} initialFollowing={null} />}
      <ShareButton title={`${room.host.username} is live on Kamby`} path={`/live/${room.id}`} compact />
    </div>
  );
}

// --- The host's numbers after ending ---------------------------------------------------------

export function LiveSummaryView({ summary }: { summary: LiveSummary }) {
  const t = useTranslations('live');
  const h = Math.floor(summary.durationSec / 3600);
  const m = Math.floor((summary.durationSec % 3600) / 60);
  const duration = h > 0 ? `${h}h ${m}m` : `${m}m ${summary.durationSec % 60}s`;
  const stats = [
    { label: t('sumDuration'), value: duration },
    { label: t('sumPeak'), value: formatCompactCount(summary.peakViewers) },
    { label: t('sumTips'), value: `$${summary.tipsUsd.toFixed(2)}`, sub: summary.tips ? `× ${summary.tips}` : undefined },
    { label: t('sumChat'), value: formatCompactCount(summary.chatLines) },
    { label: t('sumReactions'), value: formatCompactCount(summary.reactions) },
  ];
  return (
    <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left">
          <p className="font-body text-[0.65rem] font-semibold uppercase tracking-wider text-white/45">{s.label}</p>
          <p className="mt-1 font-display text-xl font-black tabular-nums text-white">{s.value}</p>
          {s.sub && <p className="font-mono text-[0.65rem] text-white/45">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** Removes a highlighted tip when its time is up. */
export function useTipHighlight(lines: LiveChatLine[]): LiveChatLine | null {
  const [tip, setTip] = useState<LiveChatLine | null>(null);
  const last = lines.length ? lines[lines.length - 1] : null;
  useEffect(() => {
    if (!last || last.kind !== 'tip') return;
    setTip(last);
    const timer = setTimeout(() => setTip((cur) => (cur?.id === last.id ? null : cur)), tipHoldMs(last.amountUsd ?? 5));
    return () => clearTimeout(timer);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return tip;
}

// --- Polls (Twitch / YouTube style — votes only, no money) -----------------------------------

/** The poll over the chat: tap an answer to vote (tap another to change), live results. */
export function PollCard({ roomId, poll, isHost, onEnd }: { roomId: string; poll: LivePoll; isHost: boolean; onEnd: () => void }) {
  const t = useTranslations('live');
  const [mine, setMine] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((Date.parse(poll.endsAt) - now) / 1000));
  const closed = poll.closed || left === 0;
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const top = Math.max(...poll.options.map((o) => o.votes));
  return (
    <div className="rounded-xl border border-[#5CEFFF]/25 bg-[#5CEFFF]/[0.05] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-xs font-black text-white">📊 {poll.question}</p>
        <span className="shrink-0 font-mono text-[0.6rem] text-white/50">{closed ? t('pollClosed') : `${left}s`}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {poll.options.map((o, i) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const showResult = closed || mine !== null || isHost;
          return (
            <button
              key={i}
              type="button"
              disabled={closed || isHost}
              onClick={() => {
                setMine(i);
                void voteLivePoll(roomId, poll.id, i).catch(() => undefined);
              }}
              className={cn(
                'relative overflow-hidden rounded-lg border px-2.5 py-1.5 text-left font-display text-xs font-bold',
                mine === i ? 'border-[#5CEFFF]/60 text-white' : 'border-white/10 text-white/85',
                !closed && !isHost && 'hover:border-white/25',
              )}
            >
              {showResult && <span className={cn('absolute inset-y-0 left-0', closed && o.votes === top && top > 0 ? 'bg-[#5CEFFF]/25' : 'bg-white/[0.07]')} style={{ width: `${pct}%` }} aria-hidden />}
              <span className="relative flex justify-between gap-2">
                <span className="truncate">{o.text}</span>
                {showResult && <span className="font-mono text-[0.65rem] text-white/70">{pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[0.6rem] text-white/45">
        <span>{t('pollVotes', { count: total })}</span>
        {isHost && !closed && (
          <button type="button" onClick={onEnd} className="font-display text-[0.65rem] font-bold text-[#FF8FA8]">
            {t('pollEnd')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The host's "new poll" sheet: a question, 2–4 answers, how long. */
export function PollSheet({ open, onClose, roomId, onError }: { open: boolean; onClose: () => void; roomId: string; onError: (msg: string) => void }) {
  const t = useTranslations('live');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [seconds, setSeconds] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const filled = options.filter((o) => o.trim()).length;
  const can = question.trim().length > 0 && filled >= LIVE_POLL_LIMITS.minOptions && !busy;
  async function start() {
    setBusy(true);
    try {
      await startLivePoll(roomId, question.trim(), options.map((o) => o.trim()).filter(Boolean), seconds);
      setQuestion('');
      setOptions(['', '']);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label={t('pollNew')} className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0A0B0F] p-5 md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="font-display text-lg font-black text-white">📊 {t('pollNew')}</p>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, LIVE_POLL_LIMITS.questionMax))}
          placeholder={t('pollQuestion')}
          aria-label={t('pollQuestion')}
          className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black px-3 font-body text-sm text-white placeholder:text-white/35 focus:outline-none"
        />
        <div className="mt-2 flex flex-col gap-2">
          {options.map((o, i) => (
            <input
              key={i}
              value={o}
              onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value.slice(0, LIVE_POLL_LIMITS.optionMax) : x)))}
              placeholder={t('pollOption', { n: i + 1 })}
              aria-label={t('pollOption', { n: i + 1 })}
              className="h-10 w-full rounded-xl border border-white/10 bg-black px-3 font-body text-sm text-white placeholder:text-white/35 focus:outline-none"
            />
          ))}
          {options.length < LIVE_POLL_LIMITS.maxOptions && (
            <button type="button" onClick={() => setOptions((cur) => [...cur, ''])} className="self-start font-display text-xs font-bold text-accent">
              + {t('pollAdd')}
            </button>
          )}
        </div>
        <div className="mt-4 flex gap-1.5">
          {LIVE_POLL_LIMITS.durations.map((d) => (
            <button key={d} type="button" onClick={() => setSeconds(d)} aria-pressed={seconds === d} className={cn('h-9 flex-1 rounded-lg border font-mono text-xs font-bold', seconds === d ? 'border-accent text-accent' : 'border-white/10 text-white/70')}>
              {d < 60 ? `${d}s` : `${d / 60}m`}
            </button>
          ))}
        </div>
        <button type="button" disabled={!can} onClick={() => void start()} className="mt-5 h-12 w-full rounded-2xl bg-accent font-display text-sm font-black text-black disabled:opacity-40">
          {busy ? '…' : t('pollStart')}
        </button>
      </div>
    </div>
  );
}
