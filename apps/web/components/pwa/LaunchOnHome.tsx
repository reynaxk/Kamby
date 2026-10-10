'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const LAUNCHED_KEY = 'kamby:launched';

/**
 * The installed app always starts on Home, like a native app (2026-10-10, owner: "don't land
 * on some coin right after opening the app"). An iPhone home-screen app opens on whatever page
 * it was added from — a coin, the terminal, the landing page — not the manifest's /home. Only
 * on a fresh launch (sessionStorage is new per launch) and only in the installed app; a
 * referral link (?ref=) is left alone so its code still gets saved.
 */
export function LaunchOnHome() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  useEffect(() => {
    try {
      if (!window.matchMedia('(display-mode: standalone)').matches) return;
      if (sessionStorage.getItem(LAUNCHED_KEY)) return;
      sessionStorage.setItem(LAUNCHED_KEY, '1');
      if (pathname !== '/home' && !new URLSearchParams(window.location.search).has('ref')) router.replace('/home');
    } catch {
      // Storage blocked — just stay where the app opened.
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
