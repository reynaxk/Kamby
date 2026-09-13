'use client';

import { cn } from '@kamby/ui';
import { useTerminalToast } from './ToastProvider';
import { MOCK_POSITIONS } from './mock-data';

/**
 * Desktop-only fixed footer tracking "open positions" — mock data (see PreviewBanner);
 * real position tracking (entry price history, live PnL) doesn't exist in the backend yet.
 * "Sell 50%" / "Panic Sell 100%" are deliberately wired to a toast explaining that, not
 * silently doing nothing — a button that looks actionable but produces zero feedback when
 * clicked is its own kind of dishonest UI, worse than one that's visibly a demo.
 */
export function PositionsBar() {
  const toast = useTerminalToast();

  function handleMockSell(ticker: string, fraction: string) {
    toast.push({
      variant: 'error',
      title: `${fraction} sell — preview only`,
      description: `${ticker} is a mock position. Real position tracking ships post-launch; trade for real at /solana.`,
    });
  }

  if (MOCK_POSITIONS.length === 0) return null;

  return (
    <div className="hidden border-t border-line bg-surface/95 backdrop-blur lg:block">
      <div className="mx-auto flex max-w-[1600px] items-stretch divide-x divide-line overflow-x-auto">
        {MOCK_POSITIONS.map((position) => {
          const pnlPct = ((position.currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;
          const pnlUsd = (position.sizeUsd * pnlPct) / 100;
          const isUp = pnlPct >= 0;
          return (
            <div key={position.id} className="flex shrink-0 items-center gap-4 px-4 py-2.5 font-mono text-xs">
              <span className="font-display text-sm font-bold text-ink-900">${position.ticker}</span>
              <div>
                <div className="text-[0.6rem] uppercase tracking-wide text-ink-400">Entry</div>
                <div className="text-ink-900">${position.entryPriceUsd.toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[0.6rem] uppercase tracking-wide text-ink-400">PnL</div>
                <div className={cn('font-semibold', isUp ? 'text-up' : 'text-down')}>
                  {isUp ? '+' : ''}
                  {pnlPct.toFixed(1)}% ({isUp ? '+' : ''}${pnlUsd.toFixed(0)})
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleMockSell(position.ticker, '50%')}
                className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-600 hover:border-warn/60 hover:text-warn"
              >
                Sell 50%
              </button>
              <button
                type="button"
                onClick={() => handleMockSell(position.ticker, '100%')}
                className="rounded-full border border-down/40 px-2.5 py-1 font-semibold text-down hover:bg-down/10"
              >
                Panic Sell
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
