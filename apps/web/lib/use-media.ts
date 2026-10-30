'use client';

import { useEffect, useState } from 'react';

/** Whether a CSS media query matches — null until the browser has answered (server render). */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Tailwind's xl breakpoint — the wide desktop home (2026-10-30 redesign). */
export const XL_QUERY = '(min-width: 1280px)';
