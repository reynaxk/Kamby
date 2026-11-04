'use client';

import { useEffect } from 'react';
import { rememberCoinTab } from '@/lib/coin-tabs';

/** Mounted on a coin's page: adds the coin to the tabs under the top menu. Renders nothing. */
export function RememberCoinTab({ chainIdentifier, address, symbol, logoUrl, href }: { chainIdentifier: string; address: string; symbol: string | null; logoUrl: string | null; href: string }) {
  useEffect(() => {
    rememberCoinTab({ chainIdentifier, address, symbol, logoUrl, href });
  }, [chainIdentifier, address, symbol, logoUrl, href]);
  return null;
}
