'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CallState, DmConversation } from '@kamby/domain';
import { useTranslations } from 'next-intl';
import { CallEngine } from '@/lib/call-engine';
import { declineCall, joinCall, startCall as apiStartCall } from '@/lib/calls-client';
import { fetchConversation } from '@/lib/dm-client';
import { subscribePrivateStream } from '@/lib/private-stream';
import { hasStoredSession } from '@/lib/session-client';
import { friendlyError } from '@/lib/friendly-error';
import { CallScreen } from './CallScreen';
import { IncomingCall } from './IncomingCall';

interface CallsApi {
  /** Start (or join) the call in this chat. */
  start: (conversationId: string, video: boolean) => Promise<void>;
  /** The chat that has a live call right now that you could join (from the stream). */
  liveIn: (conversationId: string) => CallState | null;
  inCall: boolean;
}

const CallsContext = createContext<CallsApi>({ start: async () => undefined, liveIn: () => null, inCall: false });
export const useCalls = () => useContext(CallsContext);

/** A ring that plays while a call comes in (WebAudio — no sound file). */
function useRingtone(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const ring = () => {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const [start, freq] of [
        [0, 880],
        [0.18, 660],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + 0.18);
      }
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        // no vibration — fine
      }
    };
    ring();
    const timer = setInterval(ring, 1600);
    return () => {
      clearInterval(timer);
      void ctx?.close();
    };
  }, [on]);
}

/**
 * Calls for the whole app (2026-10-17): listens on the private stream for calls in your chats,
 * rings when one comes in (sound + vibration, plus the phone push from the server), and shows
 * the call screen over whatever page you're on — so a call keeps going while you look at a coin.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('calls');
  const [engine, setEngine] = useState<CallEngine | null>(null);
  const [conv, setConv] = useState<DmConversation | null>(null);
  const [incoming, setIncoming] = useState<{ call: CallState; conv: DmConversation } | null>(null);
  const [live, setLive] = useState<Record<string, CallState>>({});
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const engineRef = useRef<CallEngine | null>(null);
  engineRef.current = engine;
  const meRef = useRef<string | null>(null);

  useRingtone(Boolean(incoming));

  useEffect(() => {
    if (!hasStoredSession()) return;
    return subscribePrivateStream({
      onDm: (e) => {
        if (e.type !== 'call') return;
        setLive((m) => {
          const next = { ...m };
          if (e.call) next[e.conversationId] = e.call;
          else delete next[e.conversationId];
          return next;
        });
        const current = engineRef.current;
        if (current && current.conversationId === e.conversationId) {
          if (e.call) void current.sync(e.call);
          else current.end();
          return;
        }
        if (!e.call) {
          setIncoming((inc) => (inc?.call.conversationId === e.conversationId ? null : inc));
          return;
        }
        const call = e.call;
        // Ringing me, and I'm not already in a call: show the incoming screen.
        fetchConversation(e.conversationId)
          .then((c) => {
            meRef.current = c.meId;
            if (call.ringing.includes(c.meId) && !engineRef.current) setIncoming({ call, conv: c });
            else setIncoming((inc) => (inc?.call.conversationId === e.conversationId && !call.ringing.includes(c.meId) ? null : inc));
          })
          .catch(() => undefined);
      },
    });
  }, []);

  const attach = useCallback((next: CallEngine, c: DmConversation) => {
    next.onChange = () => setTick((n) => n + 1);
    next.onEnded = () => {
      setEngine((cur) => (cur === next ? null : cur));
      setConv(null);
    };
    setConv(c);
    setEngine(next);
  }, []);

  const start = useCallback(
    async (conversationId: string, video: boolean) => {
      if (engineRef.current) return;
      setError(null);
      try {
        const c = await fetchConversation(conversationId);
        const join = await apiStartCall(conversationId, video);
        const next = await CallEngine.connect(conversationId, c.meId, join, video);
        attach(next, c);
      } catch (err) {
        setError(friendlyError(err));
      }
    },
    [attach],
  );

  async function accept(video: boolean) {
    if (!incoming) return;
    const { call, conv: c } = incoming;
    setIncoming(null);
    setError(null);
    try {
      const join = await joinCall(call.conversationId);
      const next = await CallEngine.connect(call.conversationId, c.meId, join, video);
      attach(next, c);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function decline() {
    if (!incoming) return;
    const id = incoming.call.conversationId;
    setIncoming(null);
    await declineCall(id).catch(() => undefined);
  }

  const api: CallsApi = {
    start,
    liveIn: (id) => live[id] ?? null,
    inCall: Boolean(engine),
  };

  return (
    <CallsContext.Provider value={api}>
      {children}
      {incoming && !engine && <IncomingCall call={incoming.call} conv={incoming.conv} onAccept={(v) => void accept(v)} onDecline={() => void decline()} />}
      {engine && conv && <CallScreen engine={engine} conv={conv} />}
      {error && (
        <div className="kamby-glass-solid kamby-toast-in fixed inset-x-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[80] mx-auto max-w-md rounded-2xl px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.5)]" role="alert">
          <p className="font-display text-sm font-bold text-ink-900">{t('failed')}</p>
          <p className="mt-0.5 font-body text-xs text-ink-400">{error}</p>
          <button type="button" onClick={() => setError(null)} className="mt-2 font-display text-xs font-bold text-accent">
            {t('ok')}
          </button>
        </div>
      )}
    </CallsContext.Provider>
  );
}
