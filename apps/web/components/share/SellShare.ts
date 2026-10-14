'use client';

import { useEffect, useState } from 'react';
import type { TokenPosition } from '@kamby/domain';
import { useMyPosition } from '@/lib/my-positions';
import type { PnlShare } from './PnlShareCard';

export const SHARE_CHAIN_NAME: Record<string, string> = {
  solana: 'Solana',
  'eip155:8453': 'Base',
  'eip155:56': 'BNB Chain',
  'eip155:4663': 'Robinhood',
};

/**
 * The position as it was before a sell — kept while the trade form is up (`live`) and frozen
 * once the sell is sent, because positions refresh right after it confirms and the sold part
 * (with its cost) is gone from them by then.
 */
export function useSellSnapshot(tokenAddress: string | null | undefined, live: boolean): TokenPosition | null {
  const position = useMyPosition(tokenAddress);
  const [snapshot, setSnapshot] = useState<TokenPosition | null>(position);
  useEffect(() => {
    if (live) setSnapshot(position);
  }, [live, position]);
  return snapshot;
}

/**
 * The card for a confirmed sell (2026-10-14, after GMGN): what that part cost vs what it sold
 * for. Only for a profit — a big "share" button after a loss reads wrong. Null when the numbers
 * aren't there to be honest about.
 */
export function realizedShare(snapshot: TokenPosition | null, soldQuantity: number, proceedsUsd: number, seed: string): PnlShare | null {
  if (!snapshot || !(snapshot.quantity > 0) || !(snapshot.costBasisUsd > 0) || !(soldQuantity > 0) || !(proceedsUsd > 0)) return null;
  const share = Math.min(1, soldQuantity / snapshot.quantity);
  const cost = snapshot.costBasisUsd * share;
  const pnl = proceedsUsd - cost;
  if (!(pnl > 0)) return null;
  const fees = Math.min(snapshot.feesUsd ?? 0, snapshot.costBasisUsd);
  return {
    symbol: snapshot.symbol,
    logoUrl: snapshot.logoUrl,
    seed,
    pnlUsd: pnl,
    pnlPct: (pnl / cost) * 100,
    entryPrice: (snapshot.costBasisUsd - fees) / snapshot.quantity,
    currentPrice: proceedsUsd / soldQuantity,
    investedUsd: cost,
    valueUsd: proceedsUsd,
    chainName: snapshot.chainIdentifier ? (SHARE_CHAIN_NAME[snapshot.chainIdentifier] ?? null) : null,
    sold: true,
  };
}
