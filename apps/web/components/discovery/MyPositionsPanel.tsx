'use client';

import { useEffect, useState } from 'react';
import type { TokenPosition } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatSignedCompactUsd, priceDirection } from '@/lib/format';
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
 */
export function MyPositionsPanel() {
  const [positions, setPositions] = useState<TokenPosition[] | null>(null);

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
          return (
            <div key={position.tokenAddress} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5">
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-semibold text-ink-900">
                  {position.symbol ? `$${position.symbol}` : 'Unknown'}
                </div>
                <div className="font-mono text-[0.65rem] text-ink-400">{formatCompactUsd(position.costBasisUsd)} cost basis</div>
              </div>
              <div className="shrink-0 text-right font-mono text-xs tabular-nums">
                <div className="text-ink-900">{formatCompactUsd(position.currentValueUsd)}</div>
                <div className={cn(direction === 'up' && 'text-up', direction === 'down' && 'text-down', direction === 'flat' && 'text-ink-400')}>
                  {formatSignedCompactUsd(position.unrealizedPnlUsd)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
