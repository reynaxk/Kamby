import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Explicit config so component tests can render with jsdom and resolve the `@/*` alias
 * next.config.js/tsconfig.json define — Vitest doesn't read tsconfig `paths` on its own.
 * Pure-logic tests (lib/*.test.ts) run fine under jsdom too, so one config covers both.
 */
export default defineConfig({
  // Next's tsconfig sets `jsx: "preserve"` (transformed later by Next's own compiler), which
  // esbuild doesn't treat as "automatic" — without this, JSX compiles to bare
  // React.createElement calls with no React import in scope. This mirrors what Next does at
  // build time, just for the Vitest/esbuild pipeline.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Vitest's 5000ms default leaves almost no margin for userEvent's realistic per-keystroke
    // typing delays plus real async state updates — several tests already take 2-3s in
    // isolation (e.g. SendModal's SOL-balance-fee-warning test), so any extra CPU contention
    // (turbo running every package's tests concurrently, a shared CI runner) reliably tips
    // them over 5s. Confirmed these aren't hangs: they pass in well under 3s run alone.
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
