import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [require('@kamby/config/tailwind-preset.cjs')],
  // hover: styles only on devices that really hover — on phones a tapped/scrolled-over row kept
  // its hover highlight (2026-10-12, looked like a coin was picked while just scrolling).
  future: { hoverOnlyWhenSupported: true },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
