// Generates every Kamby logo asset from one source — node apps/web/scripts/gen-logo.cjs apps/web
// (needs playwright: npx playwright install chromium).
//
// The mark (owner's pick, 2026-10-13): just a K — chunky, with round caps and joins (Phantom's
// softness), flat neon green on a near-black tile (Robinhood's boldness).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const web = process.argv[2] ?? 'apps/web';
const NEON = '#00FF87';
const INK = '#05070A';

/** The K: three thick strokes. Its box is about x 140–392, y 94–418 on the 512 grid. */
function K(color, scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<g transform="${t}" fill="none" stroke="${color}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round">
    <path d="M186 140 V372"/><path d="M200 268 L338 140"/><path d="M232 246 L346 372"/>
  </g>`;
}

const svgs = {
  // In-app mark and the Android "any" icons: the rounded dark tile with a hairline edge.
  tile: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Kamby">
  <rect x="16" y="16" width="480" height="480" rx="132" fill="${INK}"/>
  <rect x="16.5" y="16.5" width="479" height="479" rx="131.5" fill="none" stroke="#1E2230"/>
  ${K(NEON)}
</svg>
`,
  // iOS rounds the corners itself — full bleed.
  square: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${INK}"/>${K(NEON, 1.04)}</svg>`,
  // Android maskable: full bleed, the K inside the 80% safe circle.
  maskable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${INK}"/>${K(NEON, 0.8)}</svg>`,
  // Notification badge: Android paints only the alpha — a white K.
  badge: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${K('#FFFFFF', 1.25)}</svg>`,
};

/** The bare K — the launch screens' mark (no tile), like Robinhood's feather or Phantom's ghost. */
const BARE_K = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${K(NEON)}</svg>`;
/** iPhone launch screens (portrait, CSS px x DPR). The K is 52vw wide there and in AppSplash,
 *  so iOS's native launch image and the in-app intro line up exactly. */
const IPHONES = [
  [440, 956, 3], [430, 932, 3], [402, 874, 3], [393, 852, 3], [390, 844, 3],
  [428, 926, 3], [414, 896, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2],
];

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
  fs.mkdirSync(path.join(web, 'public/brand/startup'), { recursive: true });
  const kUrl = 'data:image/svg+xml;base64,' + Buffer.from(BARE_K).toString('base64');
  for (const [w, h, dpr] of IPHONES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await page.setContent(`<html><body style="margin:0;height:100vh;background:${INK};display:flex;align-items:center;justify-content:center"><img src="${kUrl}" style="width:52vw;height:52vw;display:block"></body></html>`);
    await page.waitForTimeout(150);
    const out = `public/brand/startup/kamby-${w * dpr}x${h * dpr}.png`;
    await page.screenshot({ path: path.join(web, out) });
    await page.close();
    console.log('wrote', out);
  }
  fs.writeFileSync(path.join(web, 'public/brand/kamby-k.svg'), BARE_K);
  await browser.close();
})();
