'use client';

import { formatPrice } from '@/lib/format';
import { useLivePrice } from '@/lib/use-live-price';

/** A coin's price that keeps updating (every 5s) after the page loads — starts from `initial`. */
export function LivePriceText({ mint, initial }: { mint: string; initial: number | null }) {
  const live = useLivePrice({ kind: 'solana', mint });
  return <>{formatPrice(live ?? initial)}</>;
}
