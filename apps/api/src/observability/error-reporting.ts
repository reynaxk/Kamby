import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Sentry error reporting — off unless SENTRY_DSN is set, so it's a no-op until the Sentry
 * project exists. Called once at the very top of main.ts, before Nest boots. Deliberately
 * minimal: errors only (no performance tracing, which would bill per transaction), and
 * `sendDefaultPii: false` so no IPs, cookies or request bodies ever leave the API — only the
 * error, its stack, and the request method/path passed to `reportError`.
 */
export function initErrorReporting(options: { dsn: string | undefined; environment: string; release?: string }): boolean {
  if (!options.dsn) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

/** Sends one unexpected error (a 5xx, never a 4xx the caller caused) — see AllExceptionsFilter. */
export function reportError(error: unknown, request: { method: string; path: string }): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('http.method', request.method);
    scope.setContext('request', { method: request.method, path: request.path });
    Sentry.captureException(error);
  });
}

/** Test seam — tells whether initErrorReporting enabled reporting in this process. */
export function isErrorReportingEnabled(): boolean {
  return enabled;
}
