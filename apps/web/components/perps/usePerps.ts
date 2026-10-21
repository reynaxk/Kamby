'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { fetchPerpAccount, fetchPerpMarkets, type PerpAccount, type PerpMarket } from '@/lib/hyperliquid';

/** Live perp markets (every 4 s while the page is visible). */
export function usePerpMarkets(): PerpMarket[] | null {
  const [markets, setMarkets] = useState<PerpMarket[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchPerpMarkets()
        .then((m) => !cancelled && setMarkets(m))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 4_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return markets;
}

/** The signed-in wallet's Hyperliquid account (every 5 s), and a way to refresh it now. */
export function usePerpAccount(): { address: string | undefined; account: PerpAccount | null; refresh: () => void } {
  const { address } = useAccount();
  const [account, setAccount] = useState<PerpAccount | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!address) {
      setAccount(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchPerpAccount(address)
        .then((a) => !cancelled && setAccount(a))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [address, tick]);
  return { address, account, refresh };
}

const RISK_KEY = 'kamby:perps-risk-ok';
export function riskAccepted(): boolean {
  try {
    return window.localStorage.getItem(RISK_KEY) === '1';
  } catch {
    return false;
  }
}
export function acceptRisk(): void {
  try {
    window.localStorage.setItem(RISK_KEY, '1');
  } catch {
    // remembered for this visit only
  }
}

export const usd = (n: number, digits = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** "84,394" / "2,496.6" / "0.004983" — a perp price at a readable precision. */
export function perpPx(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}
