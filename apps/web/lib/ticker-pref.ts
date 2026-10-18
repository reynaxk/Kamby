'use client';

import { useEffect, useState } from 'react';

/** The bottom coin ticker (2026-10-18, owner: off by default, an option for those who want it).
 *  A per-device choice, so it lives in this browser. */
const KEY = 'kamby:ticker';
const EVENT = 'kamby:ticker-pref';

export function readTickerEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setTickerEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked — the choice just won't stick
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether the ticker is switched on here; follows changes made anywhere on the page. */
export function useTickerEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readTickerEnabled());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
