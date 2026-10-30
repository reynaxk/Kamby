import type { MetadataRoute } from 'next';

/**
 * Installable app (PWA, 2026-10-09): Kamby can be added to an Android or iPhone home screen and
 * opens full-screen like a native app, straight into the terminal. No app-store review, and every
 * deploy reaches installed users at once. Served at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kamby',
    short_name: 'Kamby',
    description: 'The social terminal for trading — USDC only, no gas.',
    id: '/',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#020203',
    theme_color: '#020203',
    categories: ['finance'],
    // Android (2026-10-11, owner's dad's phone showed "K in a box" before the app's own splash):
    // its launch screen draws the `any` icon on background_color, so that one is the bare mark
    // (with a soft glow) — the same picture as AppSplash, so the two read as one animation. The
    // home-screen icon comes from the full-bleed `maskable` ones, which Android crops itself.
    icons: [
      { src: '/brand/kamby-splash-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/kamby-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/kamby-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
