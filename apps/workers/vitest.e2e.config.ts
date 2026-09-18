import { defineConfig } from 'vitest/config';

/**
 * Real-database end-to-end tests only — `*.e2e-spec.ts`, never picked up by the default
 * `vitest run` (that command's default include glob only matches `*.test.ts`/`*.spec.ts`,
 * which this suffix deliberately doesn't). Same two-config split apps/api already uses for
 * its own `test` vs `test:e2e` (see apps/api/test/jest-e2e.json) — a `pnpm test` run (CI or
 * local, no infra assumptions) must never require a reachable Postgres. Run this one
 * explicitly via `pnpm test:e2e`, against a real local DATABASE_URL — see
 * docs/TESTING.md#local-postgres-on-windows if that connection itself needs the Docker
 * network workaround.
 */
export default defineConfig({
  test: {
    include: ['**/*.e2e-spec.ts'],
  },
});
