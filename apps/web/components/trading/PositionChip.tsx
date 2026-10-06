'use client';

import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import type { ChartSource } from '@/lib/chart-data';
import { formatCompactUsd, formatSignedCompactUsd } from '@/lib/format';
import { useMyPosition } from '@/lib/my-positions';
import { useLivePrice } from '@/lib/use-live-price';

/**
 * Your position in this coin, next to "Trade" (2026-10-06: "I struggled to sell because I couldn't
 * find my position"). Worth now at the live price, with profit/loss vs what you paid. Nothing
 * when you hold none.
 */
export function PositionChip({ source }: { source: ChartSource }) {
  const address = source.kind === 'solana' ? source.mint : source.address;
  const position = useMyPosition(address);
  const live = useLivePrice(position ? source : null);
  const { hidden } = useBalanceVisibility();
  if (!position) return null;
  const price = live ?? position.currentPriceUsd;
  const value = price !== null ? position.quantity * price : position.currentValueUsd;
  const pnl = value !== null ? value - position.costBasisUsd : null;
  const pct = pnl !== null && position.costBasisUsd > 0 ? (pnl / position.costBasisUsd) * 100 : null;
  const up = (pnl ?? 0) >= 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[0.72rem] tabular-nums',
        up ? 'border-up/30 bg-up/10' : 'border-down/30 bg-down/10',
        hidden && 'select-none blur-sm',
      )}
      title={`You hold ${position.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${position.symbol ?? ''}`}
    >
      <span className="text-ink-600">You hold</span>
      <span className="font-semibold text-ink-900">{formatCompactUsd(value)}</span>
      <span className={up ? 'text-up' : 'text-down'}>
        {formatSignedCompactUsd(pnl)}
        {pct !== null && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}
      </span>
    </div>
  );
}

/** This coin's average entry price from your open position (cost ÷ quantity), for the chart's entry line. */
export function useEntryPrice(address: string | null | undefined): { price: number; costBasisUsd: number; quantity: number } | null {
  const position = useMyPosition(address);
  if (!position || !(position.quantity > 0) || !(position.costBasisUsd > 0)) return null;
  return { price: position.costBasisUsd / position.quantity, costBasisUsd: position.costBasisUsd, quantity: position.quantity };
}
