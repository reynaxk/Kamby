'use client';

import { useEffect, useState } from 'react';


/**
 * The closing panel's digital countdown (owner request 2026-10-05). Decorative: it loops
 * every `cycleSeconds` (2:47 by default) rather than counting to a real event — new coins launch every few seconds and
 * nothing schedules "the next runner". Starts on the client only, so the static page never
 * renders a mismatched time. `className` sets the type (font, size, colour) of the digits.
 */
export function RunnerCountdown({ className, cycleSeconds = 167 }: { className?: string; cycleSeconds?: number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const tick = () => setLeft(cycleSeconds - (Math.floor((Date.now() - start) / 1000) % cycleSeconds));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [cycleSeconds]);
  const s = left ?? cycleSeconds;
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
