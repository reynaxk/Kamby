'use client';

import { useEffect, useRef } from 'react';
import type { ChartSource } from '@/lib/chart-data';
import { formatCompactUsd } from '@/lib/format';
import { useLivePrice } from '@/lib/use-live-price';

/** Pump.fun and most launchpad coins mint exactly 1B tokens. */
const LAUNCHPAD_SUPPLY = 1_000_000_000;

/**
 * The browser tab shows the open coin's ticker and live market cap (2026-10-06: "when you click a
 * coin, see the ticker and a fast live market cap on the tab"), e.g. "$WIF · $1.82B MC — Kamby".
 * Market cap moves with the 2s live price (same supply); a coin with no known market cap uses
 * the launchpad 1B supply. Puts the page's own title back when the coin closes.
 */
export function LiveTabTitle({
  source,
  symbol,
  priceUsd,
  marketCapUsd,
  launchpadSupply = false,
}: {
  source: ChartSource | null;
  symbol: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  launchpadSupply?: boolean;
}) {
  const live = useLivePrice(source);
  const original = useRef<string | null>(null);
  const lastSet = useRef<string | null>(null);

  // On leaving, put the page title back only if it's still ours: after a client navigation the
  // next page has already set its own (2026-10-07: a BNB coin's tab kept "LOBBY on Solana").
  useEffect(() => {
    if (original.current === null) original.current = document.title;
    return () => {
      if (original.current !== null && document.title === lastSet.current) document.title = original.current;
    };
  }, []);

  useEffect(() => {
    if (!symbol) return;
    const price = live ?? priceUsd;
    const mcap =
      price !== null && marketCapUsd !== null && priceUsd !== null && priceUsd > 0
        ? marketCapUsd * (price / priceUsd)
        : price !== null && launchpadSupply
          ? price * LAUNCHPAD_SUPPLY
          : marketCapUsd;
    const ticker = `$${symbol.replace(/^\$+/, '')}`;
    document.title = mcap !== null ? `${ticker} · ${formatCompactUsd(mcap)} MC — Kamby` : `${ticker} — Kamby`;
    lastSet.current = document.title;
  }, [live, symbol, priceUsd, marketCapUsd, launchpadSupply]);

  return null;
}
