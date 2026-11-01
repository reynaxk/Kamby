'use client';

import { useEffect, useState } from 'react';

/**
 * Native-coin trading (2026-11-01, owner: "leave the USDC mechanism, different blockchain
 * balances"): trades pay with — and sell into — each chain's own coin (SOL, ETH on Base and
 * Robinhood, BNB on BSC), and the wallet pays its own network fee from it.
 *
 * Behind a switch in Settings until real test trades pass; flipping NATIVE_TRADING_DEFAULT turns
 * it on for everyone.
 */
export const NATIVE_TRADING_DEFAULT = false;
const KEY = 'kamby:pay-native';
const EVENT = 'kamby:pay-native-changed';

/** The EVM convention (and KyberSwap's) for a chain's own coin. */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** Each EVM chain's coin, and how much of it Max leaves behind for gas. */
export const NATIVE_BY_CHAIN_ID: Readonly<Record<number, { symbol: 'ETH' | 'BNB'; decimals: 18; reserve: number }>> = {
  8453: { symbol: 'ETH', decimals: 18, reserve: 0.0003 },
  56: { symbol: 'BNB', decimals: 18, reserve: 0.002 },
  4663: { symbol: 'ETH', decimals: 18, reserve: 0.0003 },
};

export function isNativeAddress(address: string | null | undefined): boolean {
  return (address ?? '').toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? NATIVE_TRADING_DEFAULT : v === '1';
  } catch {
    return NATIVE_TRADING_DEFAULT;
  }
}

export function setNativeTrading(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // private mode — this visit only
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether trades pay with the chain's own coin. */
export function useNativeTrading(): boolean {
  const [on, setOn] = useState(NATIVE_TRADING_DEFAULT);
  useEffect(() => {
    setOn(read());
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
