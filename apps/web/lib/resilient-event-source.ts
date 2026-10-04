'use client';

import type { RealtimeStatus } from './social-client';

const STALL_MS = 60_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * An EventSource that heals itself (2026-10-04 audit; same rules as lib/market-feeds.ts). The
 * browser only retries a dropped connection on its own — a stream the server answered with an
 * error (a 502 during an API redeploy) closes for good. This reopens a closed stream with
 * backoff, restarts one silent for 60s (servers heartbeat every 25s), and reconnects at once
 * when the browser comes back online. `events` maps event names to handlers; returns close().
 */
export function openResilientEventSource(url: string, events: Record<string, () => void>, onStatus: (status: RealtimeStatus) => void): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let retries = 0;
  let lastEventAt = Date.now();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    onStatus(retries === 0 ? 'connecting' : 'reconnecting');
    const es = new EventSource(url);
    source = es;
    lastEventAt = Date.now();
    for (const [name, handler] of Object.entries(events)) {
      es.addEventListener(name, () => {
        lastEventAt = Date.now();
        handler();
      });
    }
    es.addEventListener('heartbeat', () => {
      lastEventAt = Date.now();
      onStatus('live');
    });
    es.onopen = () => {
      lastEventAt = Date.now();
      retries = 0;
      onStatus('live');
    };
    es.onerror = () => {
      onStatus('reconnecting');
      if (es.readyState === EventSource.CLOSED) reopen(BACKOFF_MS[Math.min(retries++, BACKOFF_MS.length - 1)]!);
    };
  };

  const reopen = (delayMs: number) => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      source?.close();
      open();
    }, delayMs);
  };

  const watchdog = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastEventAt > STALL_MS) {
      lastEventAt = Date.now();
      reopen(0);
    }
  }, 15_000);
  const onOnline = () => {
    retries = 0;
    reopen(0);
  };
  window.addEventListener('online', onOnline);

  open();
  return () => {
    closed = true;
    source?.close();
    if (retryTimer) clearTimeout(retryTimer);
    clearInterval(watchdog);
    window.removeEventListener('online', onOnline);
  };
}
