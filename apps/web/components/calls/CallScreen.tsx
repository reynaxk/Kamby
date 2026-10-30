'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DmConversation, DmPerson } from '@kamby/domain';
import { cn } from '@kamby/ui';
import type { CallEngine, RemoteMedia } from '@/lib/call-engine';
import { reportConversation } from '@/lib/dm-client';
import { friendlyError } from '@/lib/friendly-error';
import { DmAvatar } from '@/components/dm/DmAvatar';

function Video({ track, mirror = false, contain = false, className }: { track: MediaStreamTrack; mirror?: boolean; contain?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={cn('h-full w-full', contain ? 'object-contain' : 'object-cover', mirror && '-scale-x-100', className)} />;
}

/** Plays one person's voice (an <audio> per remote audio track). */
function Voice({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = new MediaStream([track]);
    void ref.current.play().catch(() => undefined);
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function useTimer(startIso: string): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Tile({ media, person, big = false }: { media: RemoteMedia; person: DmPerson | undefined; big?: boolean }) {
  const t = useTranslations('calls');
  const name = person?.username ? `@${person.username}` : t('someone');
  return (
    <div className={cn('relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]', big ? 'h-full' : 'aspect-[3/4]')}>
      {media.video ? (
        <Video track={media.video} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3">
          <DmAvatar name={person?.username ?? null} src={person?.avatarUrl ?? null} className={big ? 'h-28 w-28 text-4xl' : 'h-16 w-16 text-xl'} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 font-display text-xs font-bold text-white backdrop-blur">
        {media.muted && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF3B69" strokeWidth="2.4" strokeLinecap="round" aria-label={t('muted')}>
            <path d="M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 10v2a7 7 0 0 1-.6 2.9M5 10v2a7 7 0 0 0 11.4 5.4M12 19v3" />
          </svg>
        )}
        {name}
      </span>
    </div>
  );
}

function Control({ on, label, onClick, danger = false, children }: { on?: boolean; label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        'flex h-14 w-14 items-center justify-center rounded-full transition-transform active:scale-90',
        danger ? 'bg-[#FF3B69] text-white' : on ? 'bg-white text-black' : 'bg-white/[0.12] text-white',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The call (2026-10-17): everyone as glass tiles (camera or avatar, a red mic when muted), a
 * shared screen takes the stage when someone shares, your own camera in a corner. Controls in
 * a frosted capsule: mic, camera, flip, screen, hang up — and Report at the top (leaves the
 * call and blocks / leaves the chat). Owner's rules: camera off unless you turn it on, no
 * recording.
 */
export function CallScreen({ engine, conv }: { engine: CallEngine; conv: DmConversation }) {
  const t = useTranslations('calls');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = new Map<string, DmPerson>([...(conv.group?.members ?? []), ...(conv.other ? [conv.other] : [])].map((p) => [p.userId, p]));
  const remotes = engine.remotes();
  const timer = useTimer(engine.call.startedAt);
  const title = conv.group ? conv.group.title : conv.other?.username ? `@${conv.other.username}` : t('someone');
  const sharer = remotes.find((r) => r.screen);
  const myScreen = engine.localTrack('screen');
  const myCamera = engine.localTrack('video');
  const ringingOnly = remotes.length === 0;
  const connecting = engine.connectionState !== 'connected' && !ringingOnly;

  async function run(key: string, job: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await job();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function report() {
    if (!window.confirm(t('reportConfirm'))) return;
    await engine.leave();
    await reportConversation(conv.id).catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#020203] text-white" role="dialog" aria-label={t('inCall')}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(48rem_30rem_at_100%_0%,rgba(72,88,255,0.18),transparent_62%),radial-gradient(34rem_24rem_at_0%_100%,rgba(0,255,135,0.10),transparent_60%)]" />
      {remotes.map((r) => r.audio && <Voice key={`${r.userId}:a`} track={r.audio} />)}

      {/* Top */}
      <div className="relative flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-black">{title}</p>
          <p className="font-body text-xs text-white/50">{ringingOnly ? t('ringing') : connecting ? t('connecting') : timer}</p>
        </div>
        <button type="button" onClick={() => void report()} className="rounded-full bg-white/[0.08] px-3 py-1.5 font-body text-xs font-semibold text-white/70" aria-label={t('report')}>
          ⚑ {t('report')}
        </button>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 px-3 pb-3">
        {sharer ? (
          <div className="flex h-full flex-col gap-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black">
              <Video track={sharer.screen!} contain />
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 font-display text-xs font-bold">🖥️ {t('sharing', { name: people.get(sharer.userId)?.username ? `@${people.get(sharer.userId)!.username}` : t('someone') })}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {remotes.map((r) => (
                <div key={r.userId} className="w-24 shrink-0">
                  <Tile media={r} person={people.get(r.userId)} />
                </div>
              ))}
            </div>
          </div>
        ) : ringingOnly ? (
          <div className="flex h-full flex-col items-center justify-center">
            {conv.group ? null : <DmAvatar name={conv.other?.username ?? null} src={conv.other?.avatarUrl ?? null} className="h-28 w-28 animate-pulse text-4xl" />}
            <p className="mt-4 font-body text-sm text-white/60">{t('ringing')}</p>
          </div>
        ) : remotes.length === 1 ? (
          <Tile media={remotes[0]!} person={people.get(remotes[0]!.userId)} big />
        ) : (
          <div className={cn('grid h-full content-start gap-2 overflow-y-auto', remotes.length <= 4 ? 'grid-cols-2' : 'grid-cols-3')}>
            {remotes.map((r) => (
              <Tile key={r.userId} media={r} person={people.get(r.userId)} />
            ))}
          </div>
        )}

        {/* Me */}
        {(myCamera || myScreen) && (
          <div className="absolute bottom-5 right-5 h-36 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
            <Video track={(myCamera ?? myScreen)!} mirror={Boolean(myCamera) && engine.facing === 'user'} contain={!myCamera} />
          </div>
        )}
      </div>

      {error && <p className="relative mx-4 mb-2 rounded-2xl bg-[#FF3B69]/15 px-3 py-2 text-center font-body text-xs text-[#FF8FA8]">{error}</p>}

      {/* Controls */}
      <div className="relative px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="kamby-glass-solid mx-auto flex max-w-md items-center justify-around rounded-[2rem] px-3 py-3">
          <Control on={engine.muted} label={engine.muted ? t('unmute') : t('mute')} onClick={() => void run('mic', () => engine.setMuted(!engine.muted))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {engine.muted ? <path d="M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 10v2a7 7 0 0 1-.6 2.9M5 10v2a7 7 0 0 0 11.4 5.4M12 19v3" /> : <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />}
            </svg>
          </Control>
          <Control on={Boolean(myCamera)} label={myCamera ? t('cameraOff') : t('cameraOn')} onClick={() => void run('cam', () => engine.setCamera(!myCamera))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m22 8-6 4 6 4V8Z" />
              <rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>
          </Control>
          {myCamera && (
            <Control label={t('flip')} onClick={() => void run('flip', () => engine.flipCamera())}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 7h13l-3-3M21 17H8l3 3" />
              </svg>
            </Control>
          )}
          {engine.canShareScreen && (
            <Control on={Boolean(myScreen)} label={myScreen ? t('stopShare') : t('share')} onClick={() => void run('screen', () => engine.setScreen(!myScreen))}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="4" width="20" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </Control>
          )}
          <Control danger label={t('hangUp')} onClick={() => void engine.leave()}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.27 11.27 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z" />
            </svg>
          </Control>
        </div>
        {busy && <p className="mt-2 text-center font-body text-[0.65rem] text-white/40">…</p>}
      </div>
    </div>
  );
}
