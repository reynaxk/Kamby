/*
 * Kamby service worker (PWA, 2026-10-09). Nothing that matters is ever served from a cache —
 * prices, balances, quotes, API calls and pages always come from the network. Since 2026-11-01
 * (owner: the app opened slowly) the app's own build files — /_next/static, whose names change
 * with every deploy so a cached copy can never be stale — are kept after
 * the first load, so reopening the app doesn't download them again. The offline page shows when
 * a page can't load at all.
 */
const CACHE = 'kamby-offline-v5';
const STATIC_CACHE = 'kamby-static-v1';
// Cloudflare serves /offline.html at /offline (a redirected response can't answer a navigation).
const OFFLINE_URL = '/offline';
/** Old builds' files are dropped once the cache holds more than this many. */
const STATIC_MAX = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > STATIC_MAX) await Promise.all(keys.slice(0, keys.length - STATIC_MAX).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Page loads: network first, the offline page if there's no connection.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  const url = new URL(req.url);
  if (!isStaticAsset(url)) return; // API calls, streams, other sites: untouched.
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).then(() => trim(cache)).catch(() => undefined);
      }
      return res;
    }),
  );
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
      // A newer line from the same chat replaces the old banner but still buzzes (2026-10-17).
      renotify: Boolean(data.renotify && data.tag),
      vibrate: [60, 40, 60],
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
