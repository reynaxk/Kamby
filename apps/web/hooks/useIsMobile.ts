'use client';

import { useEffect, useState } from 'react';

/** Matches Tailwind's `lg` breakpoint (1024px) exactly — this is the single source of truth
 *  for "mobile" everywhere a component needs to branch in JS (not just hide/show via CSS),
 *  e.g. rendering the terminal's drawer-based mobile layout instead of its 3-column desktop
 *  grid. Kept in sync with tailwind.config's default `lg` by convention, not by import —
 *  Tailwind doesn't expose its breakpoints to JS without a build-time plugin, and one query
 *  isn't worth adding for it. */
const MOBILE_QUERY = '(max-width: 1023px)';

/** Defaults to `false` (desktop) on the server and on first client render — same value both
 *  places, so this never causes a hydration mismatch — then corrects via `useEffect` once
 *  the real viewport is known. Mobile visitors briefly see the desktop layout for one frame
 *  before it corrects; the alternative (guessing at render time) risks a real hydration
 *  error instead, which is worse. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
