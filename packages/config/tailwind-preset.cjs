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
        up: 'rgb(var(--kamby-up) / <alpha-value>)',
        down: 'rgb(var(--kamby-down) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
        body: ['var(--font-source-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
