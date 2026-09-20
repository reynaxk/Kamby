/**
 * Shared Tailwind preset. Carries the product's design tokens so every app (web today,
 * anything else later) draws from one palette instead of redefining colors locally.
 * Actual values live in each app's globals.css as CSS custom properties (light in :root,
 * dark under the prefers-color-scheme override) — this file only names the tokens.
 */
module.exports = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--kamby-bg) / <alpha-value>)',
        surface: 'rgb(var(--kamby-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--kamby-surface-raised) / <alpha-value>)',
        line: 'rgb(var(--kamby-line) / <alpha-value>)',
        ink: {
          900: 'rgb(var(--kamby-ink-900) / <alpha-value>)',
          600: 'rgb(var(--kamby-ink-600) / <alpha-value>)',
          400: 'rgb(var(--kamby-ink-400) / <alpha-value>)',
        },
        accent: 'rgb(var(--kamby-accent) / <alpha-value>)',
        // The text color safe to put ON TOP of an accent-colored background — not always
        // white. --kamby-accent-ink's own doc comment in globals.css explains why this
        // needs to be its own token rather than a hardcoded `text-white` at every call
        // site: a bright, light-toned accent (like the Void theme's neon green) needs dark
        // text, not white, to stay readable.
        'accent-ink': 'rgb(var(--kamby-accent-ink) / <alpha-value>)',
        up: 'rgb(var(--kamby-up) / <alpha-value>)',
        down: 'rgb(var(--kamby-down) / <alpha-value>)',
        warn: 'rgb(var(--kamby-warn) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
        body: ['var(--font-source-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      // Purposeful emphasis only — composed via className at the specific call sites that
      // want it (an active order, the terminal's chart card), never baked into a shared
      // component as ambient decoration. No `glow-warn` — no call site needs it yet.
      boxShadow: {
        'glow-accent': '0 0 0 1px rgb(var(--kamby-accent) / 0.4), 0 0 24px -4px rgb(var(--kamby-accent) / 0.35)',
        'glow-up': '0 0 0 1px rgb(var(--kamby-up) / 0.35), 0 0 20px -6px rgb(var(--kamby-up) / 0.4)',
        'glow-down': '0 0 0 1px rgb(var(--kamby-down) / 0.35), 0 0 20px -6px rgb(var(--kamby-down) / 0.4)',
      },
      // Named for its one purpose (Surface's `glass` variant) rather than a generic scale
      // step, so its meaning can't silently drift later. Same numeric value as Tailwind's
      // built-in `xl`, which is what the leaderboard's original inline blur rendered as.
      backdropBlur: {
        glass: '24px',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgb(var(--kamby-accent) / 0.4), 0 0 24px -4px rgb(var(--kamby-accent) / 0.35)' },
          '50%': { boxShadow: '0 0 0 1px rgb(var(--kamby-accent) / 0.15), 0 0 8px -4px rgb(var(--kamby-accent) / 0.1)' },
        },
        // Translates a track built from the same content duplicated twice, exactly -50%
        // (one full copy's width) — the loop point is invisible since copy 2 is already
        // sitting where copy 1 started.
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        // CSS-only entrance for places that don't want a 'use client' + Framer Motion
        // boundary just to fade something in.
        'fade-in': 'fadeIn 300ms ease-out both',
        // Reserved for a genuinely in-progress state (an order actually in flight) — never
        // idle/ambient decoration.
        'glow-pulse': 'glowPulse 1.6s ease-in-out infinite',
        // The TickerBar's continuous scroll — unlike glow-pulse, ongoing motion IS this
        // component's actual content mechanism, not ambient decoration on top of it.
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
