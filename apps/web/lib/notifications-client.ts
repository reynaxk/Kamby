'use client';

import type { NotificationDto, NotificationPreferences } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';
import { subscribePrivateStream, type NotificationPing, type RealtimeStatus } from './private-stream';

/**
 * Browser-side client for the Phase 4 notification domain — same shape as
 * lib/social-client.ts (mutations + a live stream), see docs/NOTIFICATIONS.md. Every read
 * and mutation here requires a session, unlike most of social-client.ts's reads, since a
 * notification is inherently personal.
 */

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

export async function fetchNotifications(params: { cursor?: string; limit?: number } = {}): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await authedFetch(`/notifications?${query.toString()}`);
  await expectOk(res, 'load notifications');
  return res.json();
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await authedFetch('/notifications/unread-count');
  await expectOk(res, 'load unread notification count');
  const body = (await res.json()) as { count: number };
  return body.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await authedFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  await expectOk(res, 'mark notification read');
  broadcastLocalRead();
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await authedFetch('/notifications/read-all', { method: 'POST' });
  await expectOk(res, 'mark all notifications read');
  broadcastLocalRead();
}

const LOCAL_READ_EVENT = 'kamby:notifications-read';

/** This app has no shared state layer (see app/providers.tsx's own comment on that), so the
 *  bell and the full /notifications page — two independent component instances that can
 *  both mark things read — sync via a plain DOM CustomEvent instead of introducing one. */
function broadcastLocalRead(): void {
  window.dispatchEvent(new CustomEvent(LOCAL_READ_EVENT));
}

/** Subscribes to "something was marked read somewhere in this tab." Returns an unsubscribe
 *  function, same contract as subscribeToNotificationStream. */
export function onLocalNotificationsRead(callback: () => void): () => void {
  window.addEventListener(LOCAL_READ_EVENT, callback);
  return () => window.removeEventListener(LOCAL_READ_EVENT, callback);
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await authedFetch('/notifications/preferences');
  await expectOk(res, 'load notification preferences');
  return res.json();
}

export async function updateNotificationPreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const res = await authedFetch('/notifications/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await expectOk(res, 'update notification preferences');
  return res.json();
}

export type { RealtimeStatus } from './private-stream';

/**
 * Subscribes to the private per-user notification stream — see
 * docs/NOTIFICATIONS.md#realtime-delivery. Since 2026-10-17 a thin listener on the shared
 * private connection (lib/private-stream.ts), which private messages ride too.
 */
export function subscribeToNotificationStream(
  onPing: (ping: NotificationPing) => void,
  onStatus: (status: RealtimeStatus) => void,
): () => void {
  return subscribePrivateStream({ onNotification: onPing, onStatus });
}
