'use client';

import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import type { ChartSource } from '@/lib/chart-data';
import { formatCompactUsd, formatPrice, formatSignedCompactUsd } from '@/lib/format';
import { useMyPosition } from '@/lib/my-positions';
import { useLivePrice } from '@/lib/use-live-price';
import { PnlShareButton } from '@/components/share/PnlShareCard';
import { useTranslations } from 'next-intl';

/**
 * Your position in this coin, next to "Trade" (2026-10-06: "I struggled to sell because I couldn't
 * find my position"). Worth now at the live price, with profit/loss vs what you paid. Nothing
 * when you hold none.
 */
export function PositionChip({ source }: { source: ChartSource }) {
  const tPos = useTranslations('position');
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
  const entry = marketEntry(position);
  const fees = position.feesUsd ?? 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[0.72rem] tabular-nums',
        up ? 'border-up/30 bg-up/10' : 'border-down/30 bg-down/10',
        hidden && 'select-none blur-sm',
      )}
      title={`You hold ${position.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${position.symbol ?? ''}${entry !== null ? ` · bought at ${formatPrice(entry)}` : ''}${fees > 0 ? ` · Kamby fee ${formatUsdCents(fees)}` : ''}`}
    >
      <span className="text-ink-600">{tPos('youHold')}</span>
      <span className="font-semibold text-ink-900">{formatCompactUsd(value)}</span>
      <span className={up ? 'text-up' : 'text-down'}>
        {formatSignedCompactUsd(pnl)}
        {pct !== null && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}
      </span>
      {fees > 0 && <span className="text-ink-400">{tPos('fee')} {formatUsdCents(fees)}</span>}
      {pnl !== null && (
        <PnlShareButton
          className="-my-1 -mr-1.5"
          share={{ symbol: position.symbol, logoUrl: position.logoUrl, seed: address, pnlUsd: pnl, pnlPct: pct, entryPrice: entry, currentPrice: price }}
        />
      )}
    </div>
  );
}

/** The market price you bought at: what was swapped ÷ tokens received — the fee left out (it's
 *  shown on its own line; owner request 2026-10-08). Falls back to cost ÷ quantity. */
function marketEntry(position: { quantity: number; costBasisUsd: number; feesUsd?: number }): number | null {
  if (!(position.quantity > 0) || !(position.costBasisUsd > 0)) return null;
  const swapped = position.costBasisUsd - Math.min(position.feesUsd ?? 0, position.costBasisUsd);
  return (swapped > 0 ? swapped : position.costBasisUsd) / position.quantity;
}

function formatUsdCents(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** This coin's entry for the chart's entry line: the market price you bought at (see marketEntry). */
export function useEntryPrice(address: string | null | undefined): { price: number; costBasisUsd: number; quantity: number; feesUsd: number } | null {
  const position = useMyPosition(address);
  if (!position) return null;
  const price = marketEntry(position);
  if (price === null) return null;
  return { price, costBasisUsd: position.costBasisUsd, quantity: position.quantity, feesUsd: position.feesUsd ?? 0 };
}
