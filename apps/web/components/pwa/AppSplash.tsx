'use client';

import { useEffect, useState } from 'react';

const SEEN_KEY = 'kamby:splashed';
// A short beat on the K, like Robinhood's launch — then the app (2026-10-13).
const MIN_MS = 1000;
const MAX_MS = 2800;
/** Fired once by the first screen when its real data is on screen — see markAppReady. */
export const APP_READY_EVENT = 'kamby:app-ready';

/** Tells the launch splash the screen behind it is ready to be seen. Safe to call often. */
export function markAppReady(): void {
  const w = window as { __kambyReady?: boolean };
  if (w.__kambyReady) return;
  w.__kambyReady = true;
  window.dispatchEvent(new Event(APP_READY_EVENT));
}

/**
 * The installed app's launch animation (2026-10-11, owner: "it looks way more professional"):
 * just the neon K on black (since 2026-10-13, like Robinhood and Phantom), then it grows and fades away to
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
    // Stays until Home says it's ready (sign-in known, balance loaded) so nobody sees empty
    // fields fill in — at least MIN_MS so the animation always plays out, at most MAX_MS so a
    // slow connection falls back to Home's own skeleton instead of a stuck splash.
    const startedAt = Date.now();
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    let goneTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      leaveTimer = setTimeout(() => {
        setPhase('leave');
        goneTimer = setTimeout(() => setPhase('gone'), 450);
      }, Math.max(0, MIN_MS - (Date.now() - startedAt)));
    };
    const onReady = () => leave();
    window.addEventListener(APP_READY_EVENT, onReady);
    // Home may have finished before this listener existed.
    if ((window as { __kambyReady?: boolean }).__kambyReady) leave();
    const cap = setTimeout(leave, MAX_MS);
    return () => {
      window.removeEventListener(APP_READY_EVENT, onReady);
      clearTimeout(cap);
      if (leaveTimer) clearTimeout(leaveTimer);
      if (goneTimer) clearTimeout(goneTimer);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      id="kamby-splash"
      aria-hidden
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#020203] transition-opacity duration-[450ms] ease-out ${phase === 'leave' ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Just the K, centred and 52vw wide — exactly iOS's launch image (public/brand/startup),
          so the native launch screen hands over to this without a jump; like Robinhood's
          feather and Phantom's ghost (owner, 2026-10-13). It settles, then grows into the app. */}
      <div className={`kamby-splash-mark transition-transform duration-[450ms] ease-out ${phase === 'leave' ? 'scale-[1.6]' : 'scale-100'}`}>
        <svg viewBox="0 0 512 512" className="kamby-splash-k h-[52vw] w-[52vw]">
          <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" strokeLinejoin="round">
            <path d="M186 140 V372" />
            <path d="M200 268 L338 140" />
            <path d="M232 246 L346 372" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/** Runs before first paint (inline in <head>): the splash only shows on a fresh launch of the
 *  installed app. Kept as a string so it can be inlined without a bundle round trip. */
export const SPLASH_GATE_SCRIPT = `try{var s=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;if(!s||sessionStorage.getItem('${SEEN_KEY}')){document.documentElement.classList.add('no-splash')}}catch(e){document.documentElement.classList.add('no-splash')}`;
