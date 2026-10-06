'use client';

import { useEffect, useState } from 'react';
import type { TokenPosition } from '@kamby/domain';
import { fetchMyPositions, hasStoredSession } from './discovery-client';

const POLL_MS = 15_000;
/** After a trade, the ledger records it within seconds — re-read at these delays. */
const AFTER_TRADE_MS = [1_500, 5_000, 12_000];
const TRADE_EVENT = 'kamby:trade-confirmed';

let positions: TokenPosition[] | null = null;
const listeners = new Set<(p: TokenPosition[] | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function refresh(): Promise<void> {
  if (inFlight || !hasStoredSession()) return;
  inFlight = true;
  try {
    positions = await fetchMyPositions();
    listeners.forEach((l) => l(positions));
  } catch {
    // Keep the last list on screen.
  } finally {
    inFlight = false;
  }
}

function onTrade(): void {
  for (const ms of AFTER_TRADE_MS) setTimeout(() => void refresh(), ms);
}

/**
 * The signed-in user's open positions, shared by every place that shows them — the positions
 * panel, the position box by "Trade", the chart's entry line (2026-10-06: "I couldn't see my
 * position, it was hard to find"). One poll every 15s however many components listen, and an
 * immediate re-read after a trade confirms (see notifyTradeConfirmed).
 */
export function useMyPositions(): TokenPosition[] | null {
  const [value, setValue] = useState<TokenPosition[] | null>(positions);
  useEffect(() => {
    listeners.add(setValue);
    if (listeners.size === 1) {
      void refresh();
      timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
      window.addEventListener(TRADE_EVENT, onTrade);
    } else setValue(positions);
    return () => {
      listeners.delete(setValue);
      if (listeners.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        window.removeEventListener(TRADE_EVENT, onTrade);
      }
    };
  }, []);
  return value;
}

/** This user's position in one coin, or null. */
export function useMyPosition(tokenAddress: string | null | undefined): TokenPosition | null {
  const all = useMyPositions();
  if (!tokenAddress || !all) return null;
  const key = tokenAddress.toLowerCase();
  return all.find((p) => p.tokenAddress.toLowerCase() === key) ?? null;
}

/** Call when a trade confirms: positions and balances refresh right away instead of on their next poll. */
export function notifyTradeConfirmed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TRADE_EVENT));
}

export const TRADE_CONFIRMED_EVENT = TRADE_EVENT;
