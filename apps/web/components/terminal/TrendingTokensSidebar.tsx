'use client';

import { cn } from '@kamby/ui';
import { formatCompactUsd, MOCK_TRENDING_TOKENS } from './mock-data';

/** Left column of the terminal layout preview — see PreviewBanner: this list is mock data,
 *  standing in for a real trending-tokens feed that doesn't exist yet. */
export function TrendingTokensSidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-3 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-ink-400">
        Trending
      </div>
      <div className="flex-1 overflow-y-auto">
        {MOCK_TRENDING_TOKENS.map((token) => {
          const isSelected = token.id === selectedId;
          const isUp = token.gainPct >= 0;
          return (
            <button
              key={token.id}
              type="button"
              onClick={() => onSelect(token.id)}
              className={cn(
                'flex w-full items-center gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors',
                isSelected ? 'bg-accent/10' : 'hover:bg-surface-raised',
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold text-black"
                style={{ backgroundColor: `hsl(${token.avatarHue} 85% 60%)` }}
              >
                {token.avatarInitial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-semibold text-ink-900">${token.ticker}</span>
                <span className="block font-mono text-[0.65rem] text-ink-400">{formatCompactUsd(token.marketCapUsd)} MC</span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold',
                  isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
                )}
              >
                {isUp ? '+' : ''}
                {token.gainPct.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
