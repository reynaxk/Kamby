'use client';

/**
 * Phase 7 — see docs/REFERRALS.md#attribution. First-touch, permanent capture: the very
 * first `?ref=` a browser ever arrives with is the one that counts, and it must survive
 * from that first page load all the way to whenever a session actually gets created (see
 * lib/session-client.ts's `ensureSessionToken`) — which can be much later, after client-side
 * navigation has already stripped the query param from the URL. Persisting it to
 * localStorage immediately, before anything else can happen, is what makes that possible.
 */

const REFERRAL_CODE_STORAGE_KEY = 'kamby:referral-code';

/** Call once, as early as possible (see app/providers.tsx) — reads `?ref=` from the
 *  current URL and stores it, but only if nothing was captured before. A returning
 *  visitor's own organic URL (no `?ref=`, or a second, different code from clicking
 *  another friend's link) never overwrites their original attribution. */
export function captureReferralCodeFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (!code) return;
    if (window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)) return; // already captured — first touch wins
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
  } catch {
    // Storage disabled / private browsing — this visit simply won't carry attribution.
    // Never worth surfacing as an error over.
  }
}

/** Returns the previously-captured code, or `null` if this browser never arrived via a
 *  referral link (or storage was unavailable when it did). */
export function getCapturedReferralCode(): string | null {
  try {
    return window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}
