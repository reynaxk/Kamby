'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { formatCompactUsd, formatPercent } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';

/**
 * Your position in this coin, beside the trade panel (2026-11-02, from the design canvas):
 * what you put in (the cost of what you still hold), what it's worth now, and the P&L.
 * Only when you hold it — real numbers from your positions, nothing estimated.
 */
export function CoinPositionStrip({ address, className }: { address: string; className?: string }) {
  const t = useTranslations('coin');
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  const p = positions?.find((x) => x.tokenAddress.toLowerCase() === address.toLowerCase() && x.quantity > 0);
  if (!p) return null;
  const pnl = p.unrealizedPnlUsd;
  const tone = pnl === null || pnl === 0 ? 'text-ink-900' : pnl > 0 ? 'text-up' : 'text-down';
  return (
    <dl className={cn('grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-surface px-3 py-2.5 text-center', hidden && 'select-none blur-sm', className)}>
      <div>
        <dt className="font-body text-[0.7rem] text-ink-400">{t('posInvested')}</dt>
        <dd className="font-mono text-xs font-semibold tabular-nums text-ink-900">{formatCompactUsd(p.costBasisUsd)}</dd>
      </div>
      <div>
        <dt className="font-body text-[0.7rem] text-ink-400">{t('posHolding')}</dt>
        <dd className="font-mono text-xs font-semibold tabular-nums text-ink-900">{p.currentValueUsd === null ? '—' : formatCompactUsd(p.currentValueUsd)}</dd>
      </div>
      <div>
        <dt className="font-body text-[0.7rem] text-ink-400">{t('posPnl')}</dt>
        <dd className={cn('font-mono text-xs font-semibold tabular-nums', tone)}>
          {pnl === null ? '—' : `${pnl >= 0 ? '+' : '-'}${formatCompactUsd(Math.abs(pnl))}`}
          {p.unrealizedPnlPct !== null && <span className="ml-1 text-[0.65rem] opacity-80">{formatPercent(p.unrealizedPnlPct)}</span>}
        </dd>
      </div>
    </dl>
  );
}
