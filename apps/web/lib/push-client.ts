'use client';

import { authedFetch, expectOk } from './session-client';

/**
 * Phone notifications (Web Push, 2026-10-11). The browser makes a push subscription with
 * Kamby's public VAPID key; the API stores it; apps/workers sends to it. iPhones only allow
 * this in the installed app (home-screen icon, iOS 16.4+), Android everywhere.
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  // The browser has one — make sure it's this account's (another account may have used it).
  try {
    const res = await authedFetch('/notifications/push/subscriptions/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (!res.ok) return 'off';
    const body = (await res.json()) as { subscribed: boolean };
    return body.subscribed ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks for permission (must run from a tap), subscribes and saves it. */
export async function enablePush(locale: string): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const keyRes = await authedFetch('/notifications/push/public-key');
  await expectOk(keyRes, 'load the notification key');
  const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
  if (!publicKey) throw new Error('Phone notifications are not switched on yet');

  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const res = await authedFetch('/notifications/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, locale }),
  });
  await expectOk(res, 'turn on notifications');
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await authedFetch('/notifications/push/subscriptions/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return 'off';
}
