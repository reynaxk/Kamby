'use client';

import { useRef } from 'react';

/**
 * Keeps a live list's row order still between re-sorts (2026-10-10, owner: the lists visibly
 * "refreshing" was annoying — every feed patch re-sorted the rows, so coins jumped places
 * under the thumb). Values still update in place on every patch; rows keep their places,
 * newcomers join at the bottom, gone rows drop out, and the real order is applied again
 * every `resortMs`.
 */
export function useSteadyOrder<T>(rows: readonly T[], keyOf: (row: T) => string, resortMs = 45_000): T[] {
  const orderRef = useRef<string[] | null>(null);
  const sortedAtRef = useRef(0);
  const now = Date.now();
  if (orderRef.current === null || now - sortedAtRef.current >= resortMs) {
    orderRef.current = rows.map(keyOf);
    sortedAtRef.current = now;
    return [...rows];
  }
  const byKey = new Map(rows.map((row) => [keyOf(row), row] as const));
  const kept = orderRef.current.filter((key) => byKey.has(key));
  const known = new Set(kept);
  const added = rows.map(keyOf).filter((key) => !known.has(key));
  orderRef.current = [...kept, ...added];
  return orderRef.current.map((key) => byKey.get(key)!);
}
