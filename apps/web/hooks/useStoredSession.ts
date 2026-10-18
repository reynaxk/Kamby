'use client';

import { useEffect, useState } from 'react';
import { hasStoredSession, SESSION_CHANGED_EVENT } from '@/lib/session-client';

/**
 * Whether this browser has a Kamby session, kept current (2026-10-18 audit: right after
 * sign-in the account page said "Sign in to edit your profile" — it checked once on mount,
 * before the session existed, and never looked again). `null` until the first check runs, so
 * server and first client render match.
 */
export function useStoredSession(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => setHas(hasStoredSession());
    check();
    window.addEventListener(SESSION_CHANGED_EVENT, check);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, check);
  }, []);
  return has;
}
