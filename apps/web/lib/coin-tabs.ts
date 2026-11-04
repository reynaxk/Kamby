'use client';

import { useEffect, useState } from 'react';

/** A coin you opened, kept as a tab under the top menu (Kamby Prime, 2026-11-04) — like a
 *  browser: jump back to any coin you were looking at, close the ones you're done with. */
export interface CoinTab {
  chainIdentifier: string;
  address: string;
  symbol: string | null;
  logoUrl: string | null;
  href: string;
}

const KEY = 'kamby:coin-tabs';
const EVENT = 'kamby:coin-tabs';
const MAX_TABS = 6;

function read(): CoinTab[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CoinTab[];
    return Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.href === 'string' && typeof t.address === 'string') : [];
  } catch {
    return [];
  }
}

function write(tabs: CoinTab[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // private mode — the tabs just last for this page
  }
  window.dispatchEvent(new Event(EVENT));
}

const same = (a: CoinTab, b: Pick<CoinTab, 'chainIdentifier' | 'address'>) =>
  a.chainIdentifier === b.chainIdentifier && a.address.toLowerCase() === b.address.toLowerCase();

/** Opening a coin adds its tab (or refreshes it in place); the oldest falls off past six. */
export function rememberCoinTab(tab: CoinTab): void {
  const tabs = read();
  const at = tabs.findIndex((t) => same(t, tab));
  if (at >= 0) tabs[at] = tab;
  else tabs.push(tab);
  write(tabs.slice(-MAX_TABS));
}

export function closeCoinTab(tab: Pick<CoinTab, 'chainIdentifier' | 'address'>): void {
  write(read().filter((t) => !same(t, tab)));
}

export function useCoinTabs(): CoinTab[] {
  const [tabs, setTabs] = useState<CoinTab[]>([]);
  useEffect(() => {
    const sync = () => setTabs(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return tabs;
}
