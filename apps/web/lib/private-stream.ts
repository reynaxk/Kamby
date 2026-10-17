'use client';

import type { DmEvent, NotificationDto } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk } from './session-client';

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting';

export interface NotificationPing {
  userId: string;
  notificationId: string;
  type: NotificationDto['type'];
  atIso: string;
}

interface Listener {
  onNotification?: (ping: NotificationPing) => void;
  onDm?: (event: DmEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
}

/**
 * The one private live connection per app (2026-10-17): notifications and private messages
 * both arrive on `GET /notifications/stream`, so the bell, the Messages badge and an open chat
 * share a single EventSource instead of one each. It opens with the first listener and closes
 * with the last. The URL carries a single-use ticket, so the browser's own retry (same URL)
 * would always fail — every reconnect fetches a fresh ticket and opens a new EventSource.
 */
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let status: RealtimeStatus = 'connecting';
let generation = 0;

function setStatus(next: RealtimeStatus): void {
  status = next;
  listeners.forEach((l) => l.onStatus?.(next));
}

async function fetchStreamTicket(): Promise<string> {
  const res = await authedFetch('/notifications/stream-ticket', { method: 'POST' });
  await expectOk(res, 'start notification stream');
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
}

async function connect(): Promise<void> {
  const mine = ++generation;
  setStatus('connecting');
  try {
    const ticket = await fetchStreamTicket();
    if (mine !== generation || listeners.size === 0) return;
    const es = new EventSource(`${API_BASE}/v1/notifications/stream?ticket=${encodeURIComponent(ticket)}`);
    source = es;
    es.addEventListener('notification', (event) => {
      try {
        const ping = JSON.parse((event as MessageEvent<string>).data) as NotificationPing;
        listeners.forEach((l) => l.onNotification?.(ping));
      } catch {
        // A malformed ping — the next list/count fetch still catches the client up.
      }
    });
    es.addEventListener('dm', (event) => {
      try {
        const dm = JSON.parse((event as MessageEvent<string>).data) as DmEvent;
        listeners.forEach((l) => l.onDm?.(dm));
      } catch {
        // A malformed event — the open chat refetches on its next focus.
      }
    });
    es.addEventListener('heartbeat', () => setStatus('live'));
    es.onopen = () => setStatus('live');
    es.onerror = () => {
      es.close();
      if (source === es) source = null;
      setStatus('reconnecting');
      scheduleReconnect();
    };
  } catch {
    setStatus('reconnecting');
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (listeners.size > 0) void connect();
  }, 2000);
}

/** Listen on the private stream; returns an unsubscribe. */
export function subscribePrivateStream(listener: Listener): () => void {
  listeners.add(listener);
  listener.onStatus?.(status);
  if (listeners.size === 1 && !source && !retryTimer) void connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      source?.close();
      source = null;
      status = 'connecting';
    }
  };
}
