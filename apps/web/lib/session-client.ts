'use client';

import { clientEnv } from './env';
import { getCapturedReferralCode } from './referral-capture';

/**
 * The one anonymous-session primitive every browser-side API client in this app builds on
 * — social mutations (lib/social-client.ts), wallet linking (lib/wallet-client.ts), and
 * trading (lib/trading-client.ts) all authenticate the same way, against the same session
 * JWT. See docs/SOCIAL.md#authentication. Kept separate from lib/social-client.ts so
 * neither wallet nor trading code needs to import "social" to get a session.
 */

const TOKEN_STORAGE_KEY = 'kamby:session-token';
/** Which Privy sign-in this browser's Kamby session belongs to (2026-10-17). Without it, the
 *  next person to sign in on the same phone carried on in the previous person's account —
 *  their wallets were linked into it and they saw its positions and private chats. */
const OWNER_STORAGE_KEY = 'kamby:session-owner';
const API_BASE = clientEnv.NEXT_PUBLIC_API_BASE_URL;

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null; // private browsing / storage disabled — fall through to a fresh session
  }
}

/** Fired when this browser's session token appears or changes (2026-10-17) — screens that
 *  waited for a session (the chats' "who am I") check again instead of guessing. */
export const SESSION_CHANGED_EVENT = 'kamby:session-changed';

function storeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Nothing to persist to — the session still works for this page load, just won't
    // survive a refresh. Not worth surfacing as an error to the user.
  }
  try {
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
  } catch {
    // no window events (tests) — fine
  }
}

/** Forget this browser's Kamby session (sign-out, or a different person signed in). */
export function endSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(OWNER_STORAGE_KEY);
  } catch {
    // storage blocked — nothing stored to forget
  }
}

/**
 * Keeps the Kamby session with the person who's signed in: the first time a sign-in is seen it
 * claims the session; if a *different* sign-in shows up later, the old session is dropped so
 * this person starts fresh (their wallet signature then brings back their own account).
 * Returns true when it dropped a session (the caller reloads).
 */
export function bindSessionTo(privyUserId: string): boolean {
  try {
    const owner = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (owner === privyUserId) return false;
    if (owner && readStoredToken()) {
      endSession();
      window.localStorage.setItem(OWNER_STORAGE_KEY, privyUserId);
      return true;
    }
    window.localStorage.setItem(OWNER_STORAGE_KEY, privyUserId);
    return false;
  } catch {
    return false;
  }
}

/** Switch this browser to an account that already exists — the API hands one back when a
 *  wallet signature proves it's yours (a new phone, the home-screen app, a cleared browser),
 *  then everything reloads as that account (2026-10-17). */
export function resumeSession(token: string): void {
  storeToken(token);
  try {
    window.location.reload();
  } catch {
    // no window (tests)
  }
}

/** Lazily creates an anonymous session on first use — never on page load, so viewing the
 *  app never requires one (see docs/SOCIAL.md#authentication). A previously-captured
 *  referral code (see lib/referral-capture.ts) rides along on this one, one-time create
 *  call — an existing session is never re-attributed after the fact. */
export async function ensureSessionToken(): Promise<string> {
  const existing = readStoredToken();
  if (existing) return existing;

  const referredByCode = getCapturedReferralCode();
  const res = await fetch(`${API_BASE}/v1/identity/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(referredByCode ? { referredByCode } : {}),
  });
  if (!res.ok) throw new Error('Could not start a session');
  const body = (await res.json()) as { token: string };
  storeToken(body.token);
  return body.token;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureSessionToken();
  return fetch(`${API_BASE}/v1${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

/** Prefers the API's own error message (AllExceptionsFilter always returns `{message}` —
 *  see apps/api/src/common/filters/all-exceptions.filter.ts) so a user sees e.g. "This
 *  challenge has expired" instead of a generic status code. */
export async function expectOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const fallback = `Failed to ${action} (${res.status})`;
  let message = fallback;
  try {
    const body = (await res.clone().json()) as { message?: string };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Body wasn't JSON (or already consumed) — fall back to the generic message above.
  }
  throw new Error(message);
}

/** True only if this browser already has a session — never creates one. */
export function hasStoredSession(): boolean {
  return readStoredToken() !== null;
}

export { API_BASE };
