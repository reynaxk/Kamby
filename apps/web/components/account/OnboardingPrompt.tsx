'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchMyProfile } from '@/lib/profile-client';
import { hasStoredSession } from '@/lib/session-client';

const DISMISSED_KEY = 'kamby:onboarding-dismissed';

/**
 * A skippable "set up your profile" prompt — see
 * docs/TRADER_INTELLIGENCE.md#identity-username--pfp. Checks the current session's own
 * `username` once per page load; never forces a session into existence just to check
 * (`hasStoredSession()` guards that — an anonymous visitor sees nothing), and never blocks
 * trading or any other flow (a fixed-position toast, not a modal in the way of the page).
 *
 * Dismissing uses `sessionStorage`, deliberately not `localStorage`: it comes back on the
 * next real browser session rather than being suppressed forever after one skip — "skip,
 * re-offerable" per the design decision, not "dismiss once and never ask again."
 */
export function OnboardingPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasStoredSession()) return;

    let dismissedAlready = false;
    try {
      dismissedAlready = window.sessionStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Storage unavailable (private browsing) — fall through; just won't remember a skip.
    }
    if (dismissedAlready) return;

    let cancelled = false;
    fetchMyProfile()
      .then((profile) => {
        if (!cancelled && profile.username === null) setVisible(true);
      })
      .catch(() => {
        // A soft prompt, not a critical flow — a failed check just means no prompt this load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Nothing to persist to — it's still dismissed for the rest of this page load via state.
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl border border-line bg-surface-raised p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm">
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-ink-900">Set up your profile</p>
        <p className="mt-0.5 font-body text-xs text-ink-600">
          Pick a username and picture so other traders recognize you.
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        <Link
          href="/account"
          onClick={dismiss}
          className="rounded-lg bg-accent px-3 py-1.5 text-center font-body text-xs font-semibold text-accent-ink"
        >
          Set up
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg px-3 py-1.5 font-body text-xs text-ink-400 hover:text-ink-900"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
