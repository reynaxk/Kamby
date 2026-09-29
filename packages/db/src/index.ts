import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single shared PrismaClient instance.
 *
 * Kept on `globalThis` in non-production so hot-reloading apps.web / apps.api during
 * development doesn't open a fresh connection pool on every reload and exhaust Postgres'
 * connection limit — the standard pattern for Prisma in a dev server.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kambyPrisma__: PrismaClient | undefined;
}

const DEFAULT_CONNECTION_LIMIT = 15;

/** Prisma's own default pool is `num_cpus * 2 + 1` — 5 on Railway's instances — and a single
 *  token page fans out ~8 parallel queries (MarketService.getTokenTraders), so a few concurrent
 *  visitors exhausted it and every other request 500'd with P2024 after a 10s wait (seen live
 *  2026-09-29 on /leaderboard and /market/discover). 15 per process keeps api + both workers
 *  well under Postgres' default max_connections of 100. Precedence: an explicit
 *  DATABASE_CONNECTION_LIMIT env var overrides whatever the URL says (production's
 *  DATABASE_URL carries its own `connection_limit=5`, so this is the only way to raise it
 *  per-service without editing the secret); otherwise a `connection_limit` already in the URL
 *  wins; otherwise the default is appended. Edited as a string rather than round-tripped
 *  through `URL` so an unencoded character in the password can't make parsing throw. */
export function withConnectionLimit(url: string | undefined, override = process.env.DATABASE_CONNECTION_LIMIT): string | undefined {
  if (!url) return url;
  const explicit = Number(override);
  const hasLimit = /[?&]connection_limit=\d+/.test(url);
  if (explicit > 0) {
    return hasLimit
      ? url.replace(/([?&]connection_limit=)\d+/, `$1${explicit}`)
      : `${url}${url.includes('?') ? '&' : '?'}connection_limit=${explicit}`;
  }
  if (hasLimit) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${DEFAULT_CONNECTION_LIMIT}`;
}

function createPrismaClient(): PrismaClient {
  const url = withConnectionLimit(process.env.DATABASE_URL);
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    ...(url ? { datasources: { db: { url } } } : {}),
  });
}

export const prisma: PrismaClient = globalThis.__kambyPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__kambyPrisma__ = prisma;
}
