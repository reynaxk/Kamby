'use client';

import { useEffect, useState } from 'react';

/** The clock, ticking every 30s — keeps "3m ago" labels honest without a timer per row. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
