'use client';

import { useEffect, useState } from 'react';

const CYCLE_S = 195; // 03:15, then round again

/**
 * The closing panel's digital countdown (owner request 2026-10-05). Decorative: it loops
 * every 3:15 rather than counting to a real event — new coins launch every few seconds and
 * nothing schedules "the next runner". Starts on the client only, so the static page never
 * renders a mismatched time. `className` sets the type (font, size, colour) of the digits.
 */
export function RunnerCountdown({ className }: { className?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const tick = () => setLeft(CYCLE_S - (Math.floor((Date.now() - start) / 1000) % CYCLE_S));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const s = left ?? CYCLE_S;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return (
    <div className={className} aria-label={`${mm} minutes ${ss} seconds`}>
      <span className="tabular-nums">{mm}</span>
      <span className="mx-[0.06em] animate-pulse text-[#00FF87]">:</span>
      <span className="tabular-nums">{ss}</span>
    </div>
  );
}
