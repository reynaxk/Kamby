'use client';

import { useEffect, useState } from 'react';
import type { TokenPosition } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { formatCompactUsd, formatPercent, formatSignedCompactUsd, priceDirection } from '@/lib/format';
import { fetchMyPositions, hasStoredSession } from '@/lib/discovery-client';

const POLL_INTERVAL_MS = 30_000;

/**
 * The signed-in user's own currently-open positions (GET /social/positions,
 * PositionService.getMine) — real TokenLot-derived holdings, not a token-specific view
 * (unlike TokenTradersPanel, which is scoped to whichever token is selected). Renders
 * nothing at all rather than an empty state for a browser with no stored session — this
 * must never itself create one just by being on screen, same rule fetchMyPositions already
 * follows. Polls on the same cadence AutoRefresh uses elsewhere, so a just-confirmed trade
 * shows up here without needing this component wired into TradePanel's own step machinery.
 *
 * Clicking a row expands a "what if you sold now" sentence — deliberately built from
 * fields PositionService already computes honestly (currentValueUsd/unrealizedPnlUsd, FIFO
 * cost-basis-tracked) rather than a fabricated projection. Scoped to "right now", not a
 * pick-a-past-date slider: a per-trade historical USD cost basis isn't reliably available
 * (TradeTransactionDto's inputAmount is in the quote token's own units, with no stored
 * historical USD price for that token at the trade's timestamp) — this only ever states
 * what's actually, currently true.
 */
export function MyPositionsPanel() {
  const [positions, setPositions] = useState<TokenPosition[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { hidden } = useBalanceVisibility();

  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    const load = () => {
      fetchMyPositions()
        .then((result) => {
          if (!cancelled) setPositions(result);
        })
        .catch(() => {
          // A failed poll just leaves the last-known list on screen.
        });
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!hasStoredSession() || positions === null || positions.length === 0) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-ink-400">Your positions</h3>
      <div className="flex flex-col gap-2">
        {positions.map((position) => {
          const direction = priceDirection(position.unrealizedPnlUsd);
          const isExpanded = expanded === position.tokenAddress;
          return (
            <div key={position.tokenAddress} className="rounded-lg border border-line">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : position.tokenAddress)}
                aria-expanded={isExpanded}
                className="flex w-full items-center justify-between gap-2 p-2.5 text-left"
              >
                <div className="min-w-0">
                  <div className="truncate font-display text-sm font-semibold text-ink-900">
                    {position.symbol ? `$${position.symbol}` : 'Unknown'}
                  </div>
                  <div className={cn('font-mono text-[0.65rem] text-ink-400', hidden && 'blur-sm select-none')}>
                    {formatCompactUsd(position.costBasisUsd)} cost basis
                  </div>
                </div>
                <div className={cn('shrink-0 text-right font-mono text-xs tabular-nums', hidden && 'blur-sm select-none')}>
                  <div className="text-ink-900">{formatCompactUsd(position.currentValueUsd)}</div>
                  <div className={cn(direction === 'up' && 'text-up', direction === 'down' && 'text-down', direction === 'flat' && 'text-ink-400')}>
                    {formatSignedCompactUsd(position.unrealizedPnlUsd)}
                  </div>
                </div>
              </button>
              {isExpanded && (
                <div className={cn('border-t border-line px-2.5 py-2 font-body text-xs text-ink-600', hidden && 'blur-sm select-none')}>
                  If you sold <span className="font-semibold text-ink-900">${position.symbol ?? 'this'}</span> right now,
                  you&rsquo;d walk away with <span className="font-semibold text-ink-900">{formatCompactUsd(position.currentValueUsd)}</span>{' '}
                  —{' '}
                  <span className={cn(direction === 'up' && 'text-up', direction === 'down' && 'text-down', direction === 'flat' && 'text-ink-400')}>
                    {formatSignedCompactUsd(position.unrealizedPnlUsd)} ({formatPercent(position.unrealizedPnlPct)})
                  </span>{' '}
                  vs. your {formatCompactUsd(position.costBasisUsd)} cost basis.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
