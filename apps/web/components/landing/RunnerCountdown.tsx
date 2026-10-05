'use client';

import { useEffect, useState } from 'react';

const CYCLE_S = 157; // 02:37, then round again

/**
 * The final call-to-action's digital countdown (owner request 2026-10-05). Decorative: it
 * loops every 2:37 rather than counting to a real event — new coins launch every few seconds,
 * nothing schedules "the next runner". Starts on the client only, so the static page never
 * renders a mismatched time.
 */
export function RunnerCountdown() {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const tick = () => setLeft(CYCLE_S - (Math.floor((Date.now() - start) / 1000) % CYCLE_S));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const s = left ?? CYCLE_S;
  const digits = [String(Math.floor(s / 60)).padStart(2, '0'), String(s % 60).padStart(2, '0')];
  return (
    <div className="flex items-center justify-center gap-2 font-mono tabular-nums" aria-label={`${digits[0]} minutes ${digits[1]} seconds`}>
      {digits.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          {i === 1 && <span className="animate-pulse text-4xl font-bold text-[#00FF87] sm:text-6xl">:</span>}
          <div className="flex gap-1.5">
            {pair.split('').map((d, j) => (
              <span
                key={j}
                className="flex h-16 w-12 items-center justify-center rounded-xl border border-[#00FF87]/30 bg-black/50 text-4xl font-bold text-white shadow-[inset_0_0_18px_rgba(0,255,135,0.12)] sm:h-24 sm:w-[4.5rem] sm:text-6xl"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
