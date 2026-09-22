'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'kamby:balances-hidden';

const BalanceVisibilityContext = createContext<{ hidden: boolean; toggle: () => void } | null>(null);

/**
 * "Blur balances" — a per-viewer screen-privacy preference (trading in public, screen-
 * sharing, etc.), not account security: the underlying numbers are still real DOM text,
 * just visually blurred. A React Context rather than a bare localStorage-backed hook
 * because the toggle (MarketHeader) and the values it affects (MyPositionsPanel, and
 * wherever else opts in) are separate component subtrees that need to stay in sync the
 * instant it's clicked — a `window` "storage" event only fires in *other* tabs, never the
 * one that made the change, so two independent localStorage-reading hooks on the same page
 * would silently disagree until a refresh. One Provider mounted once in app/providers.tsx
 * avoids that class of bug entirely.
 *
 * Starts `false` (visible) — the only safe SSR default, same hydration-safe reasoning
 * PersonalizedSection already uses for session state — and resolves the real stored
 * preference after mount.
 */
export function BalanceVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // Private browsing / blocked storage — stays visible, the safe default.
    }
  }, []);

  function toggle() {
    setHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Nothing to persist to — the in-memory toggle for this page view still works.
      }
      return next;
    });
  }

  return <BalanceVisibilityContext.Provider value={{ hidden, toggle }}>{children}</BalanceVisibilityContext.Provider>;
}

export function useBalanceVisibility(): { hidden: boolean; toggle: () => void } {
  const ctx = useContext(BalanceVisibilityContext);
  if (!ctx) throw new Error('useBalanceVisibility must be used within a BalanceVisibilityProvider');
  return ctx;
}
