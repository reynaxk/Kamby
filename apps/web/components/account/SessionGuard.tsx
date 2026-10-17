'use client';

import { useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { bindSessionTo, endSession } from '@/lib/session-client';

/**
 * Ties this browser's Kamby session to whoever is signed in (2026-10-17): a sign-out forgets
 * it, and a different person signing in on the same phone starts clean instead of landing in
 * the previous person's account. Renders nothing.
 */
export function SessionGuard() {
  const { ready, authenticated, user } = usePrivy();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (authenticated && user?.id) {
      wasSignedIn.current = true;
      if (bindSessionTo(user.id)) window.location.reload();
    } else if (!authenticated && wasSignedIn.current) {
      // Signed out in this tab.
      wasSignedIn.current = false;
      endSession();
    }
  }, [ready, authenticated, user?.id]);

  return null;
}
