'use client';

import { useEffect, useState } from 'react';

const SEEN_KEY = 'kamby:splashed';

/**
 * The installed app's launch animation (2026-10-11, owner: "it looks way more professional"):
 * the Kamby mark on the dark screen with one neon pulse, then it grows and fades away to
 * reveal Home. Rendered in the server HTML so nothing flashes before it; the inline script
 * in app/layout.tsx hides it at once when this isn't a fresh launch of the installed app
 * (`html.no-splash`), so ordinary page loads and browser tabs never see it.
 */
export function AppSplash() {
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>('show');

  useEffect(() => {
    if (document.documentElement.classList.contains('no-splash')) {
      setPhase('gone');
      return;
    }
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // ignore
    }
    const leave = setTimeout(() => setPhase('leave'), 750);
    const gone = setTimeout(() => setPhase('gone'), 1200);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      id="kamby-splash"
      aria-hidden
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#05070A] transition-opacity duration-[450ms] ease-out ${phase === 'leave' ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className={`kamby-splash-mark transition-transform duration-[450ms] ease-out ${phase === 'leave' ? 'scale-[1.35]' : 'scale-100'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, must paint before JS */}
        <img src="/brand/kamby-mark.svg" alt="" className="h-20 w-20" />
      </div>
    </div>
  );
}

/** Runs before first paint (inline in <head>): the splash only shows on a fresh launch of the
 *  installed app. Kept as a string so it can be inlined without a bundle round trip. */
export const SPLASH_GATE_SCRIPT = `try{var s=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;if(!s||sessionStorage.getItem('${SEEN_KEY}')){document.documentElement.classList.add('no-splash')}}catch(e){document.documentElement.classList.add('no-splash')}`;
