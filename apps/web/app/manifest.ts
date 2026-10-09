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
    description: 'Trade meme coins on Solana, Base and BNB with USDC — gas-free.',
    id: '/',
    start_url: '/terminal',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#05070A',
    theme_color: '#05070A',
    categories: ['finance'],
    icons: [
      { src: '/brand/kamby-app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/kamby-app-icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
  };
}
