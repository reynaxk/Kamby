/*
 * Kamby service worker (PWA, 2026-10-09). Deliberately minimal for a trading app: nothing that
 * matters is ever served from a cache — prices, balances, quotes and pages always come from the
 * network. The only cached file is the offline page, shown when a page can't load at all.
 */
const CACHE = 'kamby-offline-v4';
// Cloudflare serves /offline.html at /offline (a redirected response can't answer a navigation).
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Page loads only: network first, the offline page if there's no connection. Everything
  // else (API calls, streams, assets) is left to the browser untouched.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// Phone notifications (Web Push, 2026-10-11) — sent by apps/workers' push dispatcher as
// { title, body, url, tag }. Shown even when the app is closed; a tap opens (or focuses)
// the app on the notification's screen.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Kamby';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/brand/kamby-app-icon-192.png',
      badge: '/brand/kamby-badge-96.png',
      tag: data.tag,
      data: { url: data.url || '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
