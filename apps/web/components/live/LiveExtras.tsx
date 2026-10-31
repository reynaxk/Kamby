'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LIVE_REACTIONS, LIVE_SLOW_OPTIONS, type LiveChatLine, type LiveReaction, type LiveRoom, type LiveSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactCount } from '@/lib/format';
import { reactInLive } from '@/lib/live-engine';
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
