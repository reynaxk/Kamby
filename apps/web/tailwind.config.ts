import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [require('@kamby/config/tailwind-preset.cjs')],
  // hover: styles only on devices that really hover — on phones a tapped/scrolled-over row kept
  // its hover highlight (2026-10-12, looked like a coin was picked while just scrolling).
  future: { hoverOnlyWhenSupported: true },
  // Calmer, pro-terminal corners (2026-11-02, owner: Axiom + GMGN mix): cards were big round
  // bubbles. Every rounded-2xl / rounded-3xl in the app tightens at once.
  theme: { extend: { borderRadius: { '2xl': '0.75rem', '3xl': '1rem' } } },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
