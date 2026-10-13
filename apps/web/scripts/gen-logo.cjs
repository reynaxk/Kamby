// Generates every Kamby logo asset from the chosen "B" mark (neon tile, black K) — 2026-10-13.
// node apps/web/scripts/gen-logo.cjs apps/web   (needs playwright: npx playwright install chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const web = process.argv[2];
const GRAD = `<linearGradient id="g" x1="80" y1="40" x2="440" y2="480" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00FF87"/><stop offset="0.55" stop-color="#00F0B5"/><stop offset="1" stop-color="#00D9FF"/></linearGradient>`;
const K = (fill, transform = '') => `<g fill="${fill}"${transform ? ` transform="${transform}"` : ''}>
    <path d="M128 104h88v304h-88z"/>
    <path d="M216 252 L340 128 L312 112 L414 96 L398 198 L382 172 L266 288 Z"/>
    <path d="M252 276 L310 228 L420 408 H322 Z"/>
  </g>`;
// The K's own box is x 128–420, y 96–408; centred on 256,256 it shifts by (-18, 0).
const CENTRED = 'translate(-18 4)';

const svgs = {
  // In-app mark and the Android "any" icons: the rounded neon tile.
  tile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Kamby"><defs>${GRAD}</defs>
  <rect x="16" y="16" width="480" height="480" rx="120" fill="url(#g)"/>
  ${K('#05070A', CENTRED)}
</svg>
`,
  // iOS rounds the corners itself — full-bleed square, same K.
  square: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRAD}</defs>
  <rect width="512" height="512" fill="url(#g)"/>
  ${K('#05070A', `translate(256 256) scale(1.08) translate(-256 -256) ${CENTRED}`)}
</svg>`,
  // Android maskable: full bleed, K inside the 80% safe circle.
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRAD}</defs>
  <rect width="512" height="512" fill="url(#g)"/>
  ${K('#05070A', `translate(256 256) scale(0.78) translate(-256 -256) ${CENTRED}`)}
</svg>`,
  // Notification badge: Android paints only the alpha — a white K, filling the square.
  badge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${K('#FFFFFF', `translate(256 256) scale(1.28) translate(-256 -256) ${CENTRED}`)}
</svg>`,
};

const outputs = [
  ['tile', 192, 'public/brand/kamby-app-icon-192.png'],
  ['tile', 512, 'public/brand/kamby-app-icon-512.png'],
  ['tile', 1024, 'public/brand/kamby-app-icon-1024.png'],
  ['tile', 512, 'public/brand/kamby-splash-512.png'],
  ['tile', 512, 'app/icon.png'],
  ['square', 180, 'app/apple-icon.png'],
  ['maskable', 192, 'public/brand/kamby-maskable-192.png'],
  ['maskable', 512, 'public/brand/kamby-maskable-512.png'],
  ['badge', 96, 'public/brand/kamby-badge-96.png'],
];

(async () => {
  fs.writeFileSync(path.join(web, 'public/brand/kamby-mark.svg'), svgs.tile);
  const browser = await chromium.launch();
  for (const [kind, size, out] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svgs[kind]).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(web, out), omitBackground: true });
    await page.close();
    console.log('wrote', out, size);
  }
  await browser.close();
})();
