'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Briefly reports which way a number just moved — the shared logic behind `GlowValue`
 * (components/market/GlowValue.tsx) and `PriceChange` (components/market/PriceChange.tsx),
 * generalized to take the number directly rather than a numeric string.
 *
 * Only ever reports a direction when the value *actually* changed between two renders —
 * a re-render with the same number, or a non-finite value, always returns `null`. Never
 * invents a direction: "up" is strictly "the new number is bigger than the old one."
 */
export function useValueFlash(value: number | null, durationMs = 700): 'up' | 'down' | null {
  const prevValueRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (prev === value) return;
    if (prev === null || value === null || !Number.isFinite(prev) || !Number.isFinite(value)) return;
    setFlash(value > prev ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);

  return flash;
}
