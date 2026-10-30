'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { LIVE_LIMITS, type LiveChatLine, type LiveRoom } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchLiveChat, fetchLiveRoom, liveStreamUrl, LiveHostEngine, LiveViewerEngine, pinLiveTrade, removeLiveLine, reportLive, sayInLive, silenceInLive } from '@/lib/live-engine';
import { slugForIdentifier } from '@kamby/domain';
import { TradeCard } from '@/components/social/TradeCard';
import { PositionPicker } from '@/components/social/PositionPicker';
import { openResilientEventSource } from '@/lib/resilient-event-source';
import { useMyUsername } from '@/lib/use-my-username';
import { friendlyError } from '@/lib/friendly-error';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatPercent, formatPrice } from '@/lib/format';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { takePendingHost } from './pending-host';
import { compactUsd, LiveDuelSheet, LivePositions, LiveTipSheet, useHostPerps } from './LiveWidgets';
import { LiveCoinPanel, useCoinPrice } from './LiveCoinPanel';
import { useMediaQuery } from '@/lib/use-media';

function Media({ track, kind, className }: { track: MediaStreamTrack; kind: 'audio' | 'video'; className?: string }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = new MediaStream([track]);
    void ref.current.play().catch(() => undefined);
  }, [track]);
  return kind === 'audio' ? <audio ref={ref} autoPlay /> : <video ref={ref} autoPlay playsInline muted className={className ?? 'h-full w-full object-contain'} />;
}

function useElapsed(startIso: string | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startIso) return '';
  const s = Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:` : ''}${h > 0 ? String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A live room (2026-10-17): the host's shared screen on stage (or their avatar with sound rings
 * for a voice live), a LIVE pill with the viewer count, Twitch-style chat over the bottom, and
 * for the host: mic, share screen, end. Viewers can Report (three reports end the room).
 *
 * 2026-10-30 (live trading streams): the host's camera (over the screen, or the whole stage), the
 * host's open perps under the stage, ⚔️ Duel and 💸 Tip for viewers, trade and tip lines in chat,
 * and the host can tap a line to remove it or silence its author. The chat keeps only the last
 * LIVE_LIMITS.chatKeep lines in the page, however long the stream runs.
 */
export function LiveRoomScreen({ id }: { id: string }) {
  const t = useTranslations('live');
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [username] = useMyUsername(authenticated);
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [picking, setPicking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [lines, setLines] = useState<LiveChatLine[]>([]);
  const [host, setHost] = useState<LiveHostEngine | null>(null);
  const [viewer, setViewer] = useState<LiveViewerEngine | null>(null);
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [sheet, setSheet] = useState<'duel' | 'tip' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Desktop (2026-10-30 redesign): the chat column has Chat / Trades tabs, the coin sits under the stage.
  const [tab, setTab] = useState<'chat' | 'trades'>('chat');
  const desktop = useMediaQuery('(min-width: 1024px)');
  // Phones: the coin's price on the stage's Trade pill (desktop has the whole panel below).
  const coinPrice = useCoinPrice(desktop === false ? (room?.coin ?? null) : null);
  const listRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(room?.startedAt);

  // The room, its chat, and its live stream.
  useEffect(() => {
    let cancelled = false;
    fetchLiveRoom(id).then((r) => {
      if (cancelled) return;
      if (r) setRoom(r);
      else setEnded(true);
    });
    fetchLiveChat(id).then((l) => !cancelled && setLines(l));
    const close = openResilientEventSource(
      liveStreamUrl(id),
      {
        room: (data) => {
          const e = JSON.parse(data) as { room: LiveRoom };
          setRoom(e.room);
        },
        chat: (data) => {
          const e = JSON.parse(data) as { line: LiveChatLine };
          setLines((l) => (l.some((x) => x.id === e.line.id) ? l : [...l, e.line].slice(-LIVE_LIMITS.chatKeep)));
        },
        removed: (data) => {
          const e = JSON.parse(data) as { lineId: string };
          setLines((l) => l.filter((x) => x.id !== e.lineId));
        },
        ended: () => setEnded(true),
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      close();
    };
  }, [id]);

  // Host: pick up the session the Go-live sheet just started.
  useEffect(() => {
    const pending = takePendingHost(id);
    if (!pending) return;
    let engine: LiveHostEngine | null = null;
    LiveHostEngine.begin(pending.join, pending.me)
      .then((e) => {
        engine = e;
        e.onChange = () => setTick((n) => n + 1);
        e.onEnded = () => setEnded(true);
        setHost(e);
      })
      .catch((err: unknown) => setError(friendlyError(err)));
    return () => engine?.end();
  }, [id]);

  // Viewer: once signed in, and when not the host.
  const isHost = Boolean(host) || Boolean(room && username && room.host.username === username);
  useEffect(() => {
    if (!ready || !authenticated || isHost || !room || viewer || ended) return;
    let engine: LiveViewerEngine | null = null;
    LiveViewerEngine.watch(id)
      .then((e) => {
        engine = e;
        e.onChange = () => setTick((n) => n + 1);
        e.onEnded = () => undefined;
        setViewer(e);
      })
      .catch((err: unknown) => setError(friendlyError(err)));
    return () => void engine?.leave();
  }, [ready, authenticated, isHost, room?.id, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // New room state → pull new tracks.
  useEffect(() => {
    if (viewer && room) void viewer.sync(room);
  }, [viewer, room]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    try {
      await sayInLive(id, body);
      setDraft('');
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function pin(chain: string, tokenAddress: string) {
    setPicking(false);
    const r = await pinLiveTrade(id, { chain, tokenAddress }).catch((err: unknown) => {
      setError(friendlyError(err));
      return null;
    });
    if (r) setRoom(r);
  }
  async function unpin() {
    const r = await pinLiveTrade(id, null).catch(() => null);
    if (r) setRoom(r);
  }

  async function report() {
    if (!window.confirm(t('reportConfirm'))) return;
    await reportLive(id).catch(() => undefined);
    setReported(true);
    await viewer?.leave();
    router.push('/home');
  }

  // The host's perps, straight from Hyperliquid; a new position becomes a line in this viewer's chat.
  const perps = useHostPerps(room?.host.evmAddress, (p) => {
    if (!room) return;
    const line: LiveChatLine = {
      id: `perp:${p.coin}:${Date.now()}`,
      userId: room.host.userId,
      username: room.host.username,
      avatarUrl: room.host.avatarUrl,
      body: t('opened', { amount: compactUsd(p.positionValueUsd), side: p.size > 0 ? t('long') : t('short'), coin: p.coin, leverage: p.leverage }),
      at: new Date().toISOString(),
      host: true,
      kind: 'trade',
    };
    setLines((l) => [...l, line].slice(-LIVE_LIMITS.chatKeep));
  });

  async function moderate(line: LiveChatLine, action: 'remove' | 'silence') {
    setPicked(null);
    try {
      if (action === 'remove') await removeLiveLine(id, line.id);
      else await silenceInLive(id, line.userId);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  const screen = host ? host.screenTrack() : (viewer?.track('screen') ?? null);
  const camera = host ? host.cameraTrack() : (viewer?.track('camera') ?? null);
  const voice = viewer?.track('audio') ?? null;
  const coinHref = room?.coin ? marketHref(room.coin.chainIdentifier, room.coin.tokenAddress) : null;

  if (ended) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] text-3xl" aria-hidden>
          📡
        </span>
        <p className="mt-4 font-display text-xl font-black text-ink-900">{reported ? t('reported') : t('ended')}</p>
        <Link href="/home" className="mt-6 rounded-2xl bg-accent px-6 py-3 font-display text-sm font-bold text-black">
          {t('backHome')}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#020203] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_26rem_at_50%_0%,rgba(255,59,105,0.12),transparent_60%),radial-gradient(36rem_24rem_at_100%_100%,rgba(72,88,255,0.14),transparent_62%)]" />
      {voice && <Media track={voice} kind="audio" />}

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="relative flex min-h-0 flex-[1.15] flex-col lg:flex-1 lg:overflow-y-auto lg:px-3 lg:pb-4">
      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-2.5 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
        <button type="button" aria-label={t('back')} onClick={() => (window.history.length > 1 ? router.back() : router.push('/home'))} className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 active:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <DmAvatar name={room?.host.username ?? null} src={room?.host.avatarUrl ?? null} className="h-9 w-9 text-sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold">{room?.title ?? '…'}</span>
          <span className="block truncate font-body text-[0.7rem] text-white/50">@{room?.host.username ?? ''} · {elapsed}</span>
        </span>
        <span className="flex items-center gap-1 rounded-full bg-[#FF3B69] px-2 py-0.5 font-display text-[0.65rem] font-black tracking-wider">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          LIVE
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-body text-[0.7rem] font-semibold tabular-nums">👁 {room?.viewers ?? 0}</span>
        {!isHost && authenticated && (
          <button type="button" onClick={() => void report()} className="rounded-full bg-white/[0.08] px-2.5 py-1 font-body text-[0.7rem] font-semibold text-white/70" aria-label={t('report')}>
            ⚑
          </button>
        )}
      </header>

      {/* Stage */}
      <div className="relative z-0 mx-3 min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black/60 lg:aspect-video lg:max-h-[52vh] lg:flex-none">
        {screen ? (
          <>
            <Media track={screen} kind="video" />
            {camera && (
              <div className="absolute right-3 top-3 h-28 w-28 overflow-hidden rounded-2xl border border-white/15 bg-black md:h-40 md:w-40">
                <Media track={camera} kind="video" className="h-full w-full object-cover" />
              </div>
            )}
          </>
        ) : camera ? (
          <Media track={camera} kind="video" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <span className="relative flex items-center justify-center">
              {!room?.muted && <span aria-hidden className="absolute h-36 w-36 animate-ping rounded-full bg-accent/10 [animation-duration:2.4s]" />}
              <DmAvatar name={room?.host.username ?? null} src={room?.host.avatarUrl ?? null} className="relative h-28 w-28 text-4xl" />
            </span>
            <p className="mt-5 font-body text-sm text-white/60">{room?.muted ? t('hostMuted') : t('voiceLive')}</p>
          </div>
        )}
        {room?.coin && coinHref && (
          <Link href={coinHref} className="kamby-glass-solid absolute bottom-3 left-3 flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent font-display text-xs font-black text-black">{(room.coin.symbol ?? '?').slice(0, 1)}</span>
            <span className="font-display text-xs font-bold">{t('trade', { symbol: cashtag(room.coin.symbol ?? '') })}</span>
            {coinPrice.price !== null && (
              <span className="font-mono text-xs tabular-nums text-white/80">
                {formatPrice(coinPrice.price)}
                {coinPrice.change !== null && <span className={cn('ml-1', coinPrice.change >= 0 ? 'text-up' : 'text-down')}>{formatPercent(coinPrice.change)}</span>}
              </span>
            )}
          </Link>
        )}
      </div>

      {/* Under the stage: the host's open perps, and for viewers ⚔️ Duel / 💸 Tip */}
      {room && (
        <div className="relative z-10 mx-3 mt-2 flex flex-wrap items-center justify-end gap-2">
          <div className="min-w-0 basis-full empty:hidden md:basis-auto md:flex-1">
            <LivePositions positions={perps} />
          </div>
          {!isHost && authenticated && (
            <>
              <button type="button" onClick={() => setSheet('duel')} className="h-9 shrink-0 rounded-full bg-white/[0.08] px-3.5 font-display text-xs font-bold text-white">
                ⚔️ {t('duel')}
              </button>
              <button type="button" onClick={() => setSheet('tip')} className="h-9 shrink-0 rounded-full bg-accent px-3.5 font-display text-xs font-black text-black">
                💸 {t('tip')}
              </button>
            </>
          )}
        </div>
      )}

      {/* The host's pinned trade — viewers can ⚡ Copy Snipe it */}
      {room?.trade && (
        <div className="kamby-pop relative z-10 mx-3 mt-2">
          <TradeCard compact trade={room.trade} mine={isHost} by={`@${room.host.username}`} />
          {isHost && (
            <button type="button" onClick={() => void unpin()} aria-label={t('unpin')} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-xs text-white/70 ring-1 ring-white/15">
              ✕
            </button>
          )}
        </div>
      )}

      {/* Desktop: the coin's chart and a buy box under the stage */}
      {desktop && room?.coin && (
        <div className="relative z-10 mx-3 mt-3">
          <LiveCoinPanel coin={room.coin} />
        </div>
      )}
      </div>

      <aside className="relative flex min-h-0 flex-1 flex-col lg:w-[360px] lg:flex-none lg:border-l lg:border-white/10 lg:bg-[#040507]">
      {desktop && (
        <div role="tablist" className="flex border-b border-white/10 px-2">
          {(['chat', 'trades'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('h-12 flex-1 font-display text-sm font-bold', tab === k ? 'text-white shadow-[inset_0_-2px_0_rgb(var(--kamby-accent))]' : 'text-white/50')}
            >
              {k === 'chat' ? t('chatTab') : t('tradesTab')}
            </button>
          ))}
        </div>
      )}
      {/* Chat */}
      <div ref={listRef} className="relative z-0 mt-2 min-h-0 flex-1 overflow-y-auto px-4 [mask-image:linear-gradient(transparent,#000_18%)] lg:[mask-image:none]">
        <div className="flex min-h-full flex-col justify-end gap-1 py-2">
          {lines.slice(-LIVE_LIMITS.chatKeep).filter((l) => !desktop || tab === 'chat' || l.kind).map((l) =>
            l.kind ? (
              // Not typed by anyone: a trade (🔥) or a tip (💸), from Kamby itself.
              <p
                key={l.id}
                className={cn(
                  'kamby-chat-in self-start rounded-xl px-2.5 py-1 font-display text-[0.8rem] font-bold leading-snug',
                  l.kind === 'tip' ? 'bg-[#FACC15]/15 text-[#FDE68A]' : 'bg-accent/10 text-accent',
                )}
              >
                {l.kind === 'tip' ? '💸' : '🔥'} @{l.username} {l.kind === 'tip' && l.amountUsd ? t('tipped', { amount: `$${l.amountUsd.toFixed(2)}` }) : l.body}
              </p>
            ) : (
              <div key={l.id} className="kamby-chat-in">
                <p
                  onClick={isHost && !l.host ? () => setPicked((cur) => (cur === l.id ? null : l.id)) : undefined}
                  className={cn('font-body text-[0.85rem] leading-snug text-white/90', isHost && !l.host && 'cursor-pointer')}
                >
                  <span className={cn('mr-1.5 font-display font-bold', l.host ? 'text-[#FF8FA8]' : 'text-accent')}>
                    {l.host && '🎙️ '}@{l.username}
                  </span>
                  {l.body}
                </p>
                {picked === l.id && (
                  <div className="mt-1 flex gap-1.5">
                    <button type="button" onClick={() => void moderate(l, 'remove')} className="rounded-full bg-white/[0.1] px-3 py-1 font-display text-[0.7rem] font-bold text-white">
                      {t('remove')}
                    </button>
                    <button type="button" onClick={() => void moderate(l, 'silence')} className="rounded-full bg-[#FF3B69]/20 px-3 py-1 font-display text-[0.7rem] font-bold text-[#FF8FA8]">
                      {t('silence', { name: l.username })}
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {error && <p className="relative z-10 mx-4 mb-1 rounded-xl bg-[#FF3B69]/15 px-3 py-1.5 text-center font-body text-xs text-[#FF8FA8]">{error}</p>}

      {/* Bottom: chat input + host controls */}
      <div className="relative z-10 flex items-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-1">
        {!authenticated ? (
          <button type="button" onClick={() => login()} className="h-11 flex-1 rounded-2xl bg-accent font-display text-sm font-bold text-black">
            {t('signInToWatch')}
          </button>
        ) : (
          <form onSubmit={(e) => void send(e)} className="kamby-glass-solid kamby-glass-dense flex h-11 min-w-0 flex-1 items-center rounded-full pl-4 pr-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 200))} placeholder={t('say')} className="min-w-0 flex-1 bg-transparent font-body text-sm text-white placeholder:text-white/40 focus:outline-none" />
            <button type="submit" disabled={!draft.trim()} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black disabled:opacity-30" aria-label={t('send')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
        )}
        {host && (
          <>
            <button type="button" onClick={() => void host.setMuted(!host.muted)} aria-label={host.muted ? t('unmute') : t('mute')} className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', host.muted ? 'bg-white text-black' : 'bg-white/[0.12] text-white')}>
              {host.muted ? '🔇' : '🎙️'}
            </button>
            {host.canUseCamera && (
              <button type="button" onClick={() => void host.setCamera(!host.cameraTrack()).catch((err: unknown) => setError(friendlyError(err)))} aria-label={t('camera')} className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', host.cameraTrack() ? 'bg-white text-black' : 'bg-white/[0.12] text-white')}>
                📷
              </button>
            )}
            {host.canShareScreen && (
              <button type="button" onClick={() => void host.setScreen(!host.screenTrack()).catch((err: unknown) => setError(friendlyError(err)))} aria-label={t('share')} className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', host.screenTrack() ? 'bg-white text-black' : 'bg-white/[0.12] text-white')}>
                🖥️
              </button>
            )}
            <button type="button" onClick={() => setPicking(true)} aria-label={t('pinTrade')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-white">
              ⚡
            </button>
            <button type="button" onClick={() => void host.stop()} className="h-11 shrink-0 rounded-full bg-[#FF3B69] px-4 font-display text-xs font-black" aria-label={t('end')}>
              {t('end')}
            </button>
          </>
        )}
      </div>
      </aside>
      </div>
      {room && !isHost && (
        <>
          <LiveDuelSheet open={sheet === 'duel'} onClose={() => setSheet(null)} host={room.host} />
          <LiveTipSheet open={sheet === 'tip'} onClose={() => setSheet(null)} roomId={id} host={room.host} />
        </>
      )}
      {isHost && (
        <PositionPicker
          open={picking}
          title={t('pinTrade')}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            const slug = (p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : null)) === 'solana' ? 'solana' : slugForIdentifier(p.chainIdentifier ?? '');
            if (slug) void pin(slug, p.tokenAddress);
          }}
        />
      )}
    </div>
  );
}
