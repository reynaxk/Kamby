'use client';

import { useEffect, useState } from 'react';
import { fetchMyProfileShared } from './profile-client';
import { hasStoredSession, SESSION_CHANGED_EVENT } from './session-client';

/**
 * Your @name for the chats: `undefined` while it isn't known yet, `null` only once the server
 * has said you really have none, else the name (2026-10-17, owner: "why every time to set a
 * username, I already set"). The chats used to decide "no name" whenever the session wasn't
 * stored yet — Privy says "signed in" a moment before Kamby's session exists — or when the
 * look-up failed on a weak connection, and showed the pick-a-name form to people who had one.
 * Now: no session yet → wait for it; a failed look-up → try again, never "no name".
 */
export function useMyUsername(authenticated: boolean): [string | null | undefined, (name: string) => void] {
  const [username, setUsername] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!authenticated) {
      setUsername(undefined);
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const load = () => {
      if (cancelled) return;
      if (!hasStoredSession()) {
        // The session isn't stored yet — the event (or this poll) picks it up.
        if (tries++ < 15) retry = setTimeout(load, 2000);
        return;
      }
      fetchMyProfileShared()
        .then((p) => !cancelled && setUsername(p.username))
        .catch(() => {
          if (!cancelled && tries++ < 15) retry = setTimeout(load, 3000);
        });
    };
    const onSession = () => {
      if (retry) clearTimeout(retry);
      load();
    };
    load();
    window.addEventListener(SESSION_CHANGED_EVENT, onSession);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
    };
  }, [authenticated]);

  return [username, setUsername];
}
