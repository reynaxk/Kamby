/*
 * Kamby service worker (PWA, 2026-10-09). Deliberately minimal for a trading app: nothing that
 * matters is ever served from a cache — prices, balances, quotes and pages always come from the
 * network. The only cached file is the offline page, shown when a page can't load at all.
 */
const CACHE = 'kamby-offline-v2';
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
