'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DM_VOICE, type DmMessage } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { authedFetch } from '@/lib/session-client';

function haptic(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What this browser records best: Opus in WebM (Chrome, Android, Firefox), AAC in MP4 (Safari). */
function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/** 40 bars, 0–100, from the levels sampled while recording. */
function toBars(levels: number[]): number[] {
  if (levels.length === 0) return Array.from({ length: DM_VOICE.bars }, () => 10);
  const out: number[] = [];
  const step = levels.length / DM_VOICE.bars;
  for (let i = 0; i < DM_VOICE.bars; i++) {
    const slice = levels.slice(Math.floor(i * step), Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)));
    out.push(slice.reduce((a, b) => Math.max(a, b), 0));
  }
  const peak = Math.max(...out, 0.0001);
  return out.map((v) => Math.round(8 + (v / peak) * 92));
}

/**
 * 🎙️ Hold to record (2026-10-17, WhatsApp-style): press and hold the mic, talk (up to 60 s),
 * let go to send — slide left to cancel. A red dot, the time and a live waveform show over the
 * text field while you talk. Uses the browser's own MediaRecorder; nothing is sent until you let go.
 */
export function VoiceRecorderButton({ onSend, disabled }: { onSend: (blob: Blob, durationMs: number, waveform: number[]) => Promise<void> | void; disabled?: boolean }) {
  const t = useTranslations('dm');
  const [state, setState] = useState<'idle' | 'recording' | 'cancel'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; chunks: Blob[]; levels: number[]; startedAt: number; timer: ReturnType<typeof setInterval>; startX: number; cancelled: boolean } | null>(null);

  useEffect(() => () => void stop(true), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || rec.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    setHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const levels: number[] = [];
      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => ev.data.size > 0 && chunks.push(ev.data);
      const startedAt = Date.now();
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.sqrt(sum / buf.length);
        levels.push(level);
        setLive((l) => [...l.slice(-31), level]);
        const ms = Date.now() - startedAt;
        setElapsed(ms);
        if (ms >= DM_VOICE.maxSeconds * 1000) void finish();
      }, 100);
      recorder.start(250);
      rec.current = { recorder, stream, ctx, chunks, levels, startedAt, timer, startX, cancelled: false };
      setState('recording');
      haptic(14);
    } catch {
      setHint(t('micBlocked'));
    }
  }

  function move(e: React.PointerEvent) {
    const r = rec.current;
    if (!r) return;
    const cancel = r.startX - e.clientX > 80;
    if (cancel !== r.cancelled) {
      r.cancelled = cancel;
      setState(cancel ? 'cancel' : 'recording');
      if (cancel) haptic(8);
    }
  }

  function stop(discard: boolean): Promise<{ blob: Blob; ms: number; levels: number[] } | null> {
    const r = rec.current;
    rec.current = null;
    setState('idle');
    setLive([]);
    setElapsed(0);
    if (!r) return Promise.resolve(null);
    clearInterval(r.timer);
    return new Promise((resolve) => {
      r.recorder.onstop = () => {
        r.stream.getTracks().forEach((tr) => tr.stop());
        void r.ctx.close().catch(() => undefined);
        const ms = Date.now() - r.startedAt;
        resolve(discard ? null : { blob: new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' }), ms, levels: r.levels });
      };
      if (r.recorder.state !== 'inactive') r.recorder.stop();
      else r.recorder.onstop?.(new Event('stop'));
    });
  }

  async function finish() {
    const r = rec.current;
    if (!r) return;
    const out = await stop(r.cancelled);
    if (!out) return;
    if (out.ms < 800) {
      setHint(t('holdToRecord'));
      return;
    }
    haptic(10);
    await onSend(out.blob, Math.min(out.ms, DM_VOICE.maxSeconds * 1000), toBars(out.levels));
  }

  return (
    <>
      {state !== 'idle' && (
        <div className={cn('pointer-events-none absolute inset-y-1.5 left-1.5 right-14 z-10 flex items-center gap-2.5 rounded-[1.3rem] px-3', state === 'cancel' ? 'bg-[#2A0E18]' : 'bg-[#0B0F18]')}>
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', state === 'cancel' ? 'bg-down' : 'animate-pulse bg-down')} aria-hidden />
          <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink-900">{fmt(elapsed)}</span>
          <span className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
            {live.map((l, i) => (
              <span key={i} className={cn('w-[3px] shrink-0 rounded-full', state === 'cancel' ? 'bg-down/60' : 'bg-accent')} style={{ height: `${Math.max(12, Math.min(100, l * 380))}%` }} />
            ))}
          </span>
          <span className={cn('shrink-0 font-body text-[0.7rem] font-semibold', state === 'cancel' ? 'text-down' : 'text-ink-400')}>{state === 'cancel' ? t('releaseToCancel') : `‹ ${t('slideToCancel')}`}</span>
        </div>
      )}
      {hint && state === 'idle' && <span className="kamby-pop absolute -top-9 right-0 rounded-full bg-black/85 px-3 py-1.5 font-body text-[0.7rem] text-white">{hint}</span>}
      <button
        type="button"
        aria-label={t('recordVoice')}
        disabled={disabled}
        onPointerDown={(e) => void start(e)}
        onPointerMove={move}
        onPointerUp={() => void finish()}
        onPointerCancel={() => void stop(true)}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative flex h-10 w-10 shrink-0 touch-none select-none items-center justify-center rounded-full transition-transform disabled:opacity-30',
          state === 'idle' ? 'bg-accent text-black active:scale-90' : state === 'cancel' ? 'scale-110 bg-down text-white' : 'scale-125 bg-down text-white',
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="2.5" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
        </svg>
      </button>
    </>
  );
}

/** One voice note playing at a time across the chat. */
let nowPlaying: HTMLAudioElement | null = null;
const audioUrls = new Map<string, string>();

/**
 * 🎙️ A voice note in the chat: play / pause, the 40-bar waveform filling as it plays (tap a bar to
 * jump there), the time, and 1× / 1.5× / 2×. The audio loads on first play, from the API.
 */
export function VoiceBubble({ m, mine }: { m: DmMessage; mine: boolean }) {
  const t = useTranslations('dm');
  const v = m.voice!;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  const bars = v.waveform.length ? v.waveform : Array.from({ length: DM_VOICE.bars }, () => 20);

  useEffect(() => () => audio.current?.pause(), []);

  async function ensure(): Promise<HTMLAudioElement | null> {
    if (audio.current) return audio.current;
    setLoading(true);
    try {
      let url = audioUrls.get(m.id);
      if (!url) {
        const res = await authedFetch(`/dm/messages/${m.id}/voice`);
        if (!res.ok) throw new Error(String(res.status));
        url = URL.createObjectURL(await res.blob());
        audioUrls.set(m.id, url);
      }
      const a = new Audio(url);
      a.playbackRate = rate;
      a.ontimeupdate = () => setPos(a.currentTime * 1000);
      a.onended = () => {
        setPlaying(false);
        setPos(0);
      };
      a.onpause = () => setPlaying(false);
      a.onplay = () => setPlaying(true);
      audio.current = a;
      return a;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const a = await ensure();
    if (!a) return;
    if (a.paused) {
      if (nowPlaying && nowPlaying !== a) nowPlaying.pause();
      nowPlaying = a;
      await a.play().catch(() => setFailed(true));
    } else a.pause();
  }

  async function seek(e: React.MouseEvent<HTMLSpanElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const a = await ensure();
    if (!a) return;
    a.currentTime = (frac * v.durationMs) / 1000;
    setPos(frac * v.durationMs);
  }

  function cycleRate(e: React.MouseEvent) {
    e.stopPropagation();
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  const played = v.durationMs > 0 ? pos / v.durationMs : 0;
  return (
    <div className={cn('flex w-64 items-center gap-2.5 rounded-3xl px-2.5 py-2', mine ? 'bg-accent text-black' : 'kamby-glass text-ink-900')}>
      <button
        type="button"
        onClick={(e) => void toggle(e)}
        aria-label={playing ? t('pause') : t('play')}
        className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90', mine ? 'bg-black text-accent' : 'bg-accent text-black')}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="5" y="4" width="5" height="16" rx="1.5" />
            <rect x="14" y="4" width="5" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5" aria-hidden>
            <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.4-7.2a1 1 0 0 0 0-1.8L8.5 3.9A1 1 0 0 0 7 4.8Z" />
          </svg>
        )}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span role="slider" aria-label={t('voiceNote')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(played * 100)} tabIndex={-1} onClick={(e) => void seek(e)} className="flex h-7 cursor-pointer items-center gap-[2px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className={cn('w-[3px] flex-1 rounded-full transition-opacity', mine ? 'bg-black' : 'bg-accent', i / bars.length <= played ? 'opacity-100' : 'opacity-35')}
              style={{ height: `${Math.max(10, h)}%` }}
            />
          ))}
        </span>
        <span className={cn('flex items-center justify-between font-body text-[0.66rem] tabular-nums', mine ? 'text-black/65' : 'text-ink-400')}>
          {failed ? t('voiceFailed') : fmt(playing || pos > 0 ? pos : v.durationMs)}
          <button type="button" onClick={cycleRate} className={cn('rounded-full px-1.5 py-px font-display text-[0.6rem] font-bold', mine ? 'bg-black/10' : 'bg-white/[0.08]')}>
            {rate}×
          </button>
        </span>
      </span>
    </div>
  );
}
