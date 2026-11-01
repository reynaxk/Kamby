'use client';

import { useEffect } from 'react';
import { sendAchievementEvent } from '@/lib/achievements-client';

/**
 * The app-side counters for a few titles (2026-11-01, the owner's 50): a heartbeat while Kamby
 * is open and visible (The Terminal Rat) and the 50-taps-in-5-seconds easter egg (The Matrix
 * Glitch). Renders nothing; sends nothing when signed out.
 */
export function AchievementBeacon() {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') sendAchievementEvent('session');
    };
    beat();
    const timer = setInterval(beat, 60_000);

    let taps: { x: number; y: number; t: number }[] = [];
    let fired = false;
    const onTap = (e: PointerEvent) => {
      if (fired) return;
      const now = Date.now();
      const near = (p: { x: number; y: number }) => Math.abs(p.x - e.clientX) < 30 && Math.abs(p.y - e.clientY) < 30;
      taps = [...taps.filter((p) => now - p.t <= 5_000 && near(p)), { x: e.clientX, y: e.clientY, t: now }];
      if (taps.length >= 50) {
        fired = true;
        sendAchievementEvent('matrix');
      }
    };
    window.addEventListener('pointerdown', onTap, { passive: true });
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', onTap);
    };
  }, []);
  return null;
}
