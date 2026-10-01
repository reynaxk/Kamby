import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';

export const SSR_TOKEN_HEADER = 'x-kamby-ssr';

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

function header(req: RequestLike, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Exported for tests. The visitor's real IP. Railway's edge proxy terminates every request,
 * so the socket address (`req.ip`) is one of ~20 internal proxy addresses (100.64.0.x) —
 * throttling on it made every Kamby visitor share ~20 rate-limit buckets (found 2026-10-01,
 * before launch: 45 rapid calls to a 30/min route all passed). Railway's edge sets
 * `x-real-ip` / `x-forwarded-for` to the actual client.
 */
export function clientIp(req: RequestLike): string {
  const realIp = header(req, 'x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return req.ip ?? 'unknown';
}

/** Exported for tests. Constant-time token check; false when no token is configured. */
export function isTrustedSsrRequest(req: RequestLike, token: string | undefined): boolean {
  const presented = header(req, SSR_TOKEN_HEADER);
  if (!token || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The app-wide throttler, keyed by the visitor's real IP. The website's own server-side
 * rendering (Cloudflare Workers, a handful of shared egress IPs fetching on behalf of every
 * visitor) presents SSR_API_TOKEN and is exempt — per-IP limits on it would throttle the
 * whole site at once.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return clientIp(req as unknown as RequestLike);
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestLike>();
    return isTrustedSsrRequest(req, process.env.SSR_API_TOKEN);
  }
}
