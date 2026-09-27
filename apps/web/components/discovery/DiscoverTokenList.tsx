'use client';

import { useState } from 'react';
import { slugForIdentifier, type MarketSummary, type TrendingToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { TrenchesPanel } from '@/components/terminal/TrenchesPanel';
import { LeaderboardSidebar } from './LeaderboardSidebar';
import { SelectableTokenRow } from './SelectableTokenRow';
import { TradersSidebar } from './TradersSidebar';

type Tab = 'markets' | 'trending' | 'movers' | 'volume' | 'trenches' | 'leaderboard' | 'traders' | 'alerts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'markets', label: 'Markets' },
  { id: 'trending', label: 'Trending' },
  { id: 'movers', label: 'Movers' },
  { id: 'volume', label: 'Volume' },
  { id: 'trenches', label: 'Trenches' },
  { id: 'leaderboard', label: 'Ranks' },
  { id: 'traders', label: 'Traders' },
  { id: 'alerts', label: 'Alerts' },
];

/**
 * The terminal's left rail on Discover — tabbed across the MarketSummary lists the page
 * already fetches server-side (zero new fetches for the list itself, only the *selected*
 * token's own candles/activity/traders are fetched client-side, by DiscoverTerminal).
 *
 * The Trenches tab renders TrenchesPanel directly, unmodified, at full height — it already
 * supplies its own rounded-2xl border/bg and its own internal Fresh/Near Grad/Graduated/
 * Trending sub-tabs, so it isn't wrapped in a second bordered box here (that would nest two
 * visible frames). It's a structurally different, non-selectable browsing tool: its Pump.fun
 * categories are Solana-only with deliberately no click-through at all; only its
 * TRENDING_HOLDERS rows link anywhere, and they still navigate to /market/... as they always
 * have. Forcing it into the selectable paradigm here would misrepresent what it does.
 *
 * Markets/Trending/Movers/Volume rows can now include established Solana tokens (BONK/WIF/
 * JUP-class — see SolanaTokenMarket's own doc comment in schema.prisma), identified by
 * `chainIdentifier: 'solana'`. Same "no click-through" treatment as Trenches above, for the
 * same reason: DiscoverTerminal's selection/chart/trade flow resolves chain purely through
 * CHAIN_REGISTRY (EVM-only) — selecting a Solana row there would silently fall back to
 * treating it as a Base token. Disabled here via the same visual state `selectionDisabled`
 * already uses, rather than a separate "not clickable" concept.
 */
export function DiscoverTokenList({
  ranked,
  trending,
  movers,
  byVolume,
  selectedKey,
  onSelect,
  selectionDisabled,
}: {
  ranked: MarketSummary[];
  trending: TrendingToken[];
  movers: MarketSummary[];
  byVolume: MarketSummary[];
  selectedKey: string | null;
  onSelect: (market: MarketSummary) => void;
  selectionDisabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>('markets');
  const rowsFor: Record<Exclude<Tab, 'trenches' | 'leaderboard' | 'traders' | 'alerts'>, MarketSummary[]> = {
    markets: ranked,
    trending: trending.map((t) => t.market),
    movers,
    volume: byVolume,
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid grid-cols-4 gap-0.5 rounded-xl border border-line bg-surface p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-1.5 py-1.5 font-display text-[0.6rem] font-bold uppercase tracking-wide transition-all',
              tab === t.id ? 'bg-accent/10 text-accent shadow-glow-accent' : 'text-ink-400 hover:text-ink-600',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'trenches' ? (
        <div className="min-h-0 flex-1">
          <TrenchesPanel />
        </div>
      ) : tab === 'leaderboard' ? (
        <div className="min-h-0 flex-1">
          <LeaderboardSidebar />
        </div>
      ) : tab === 'traders' ? (
        <div className="min-h-0 flex-1">
          <TradersSidebar />
        </div>
      ) : tab === 'alerts' ? (
        <div className="min-h-0 flex-1 rounded-2xl border border-line bg-surface">
          <EmptyState
            title="Alerts aren't built yet"
            detail="Price/volume alerts are planned but don't exist yet — nothing to show here honestly."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface">
          {rowsFor[tab].length === 0 ? (
            <p className="p-3 font-body text-xs text-ink-400">Nothing here yet.</p>
          ) : (
            rowsFor[tab].map((market) => {
              const key = `${market.chainIdentifier}:${market.tokenAddress}`;
              // Solana rows aren't selectable yet — see this component's own doc comment.
              const selectable = slugForIdentifier(market.chainIdentifier) !== null;
              return (
                <SelectableTokenRow
                  key={key}
                  market={market}
                  selected={key === selectedKey}
                  onSelect={onSelect}
                  disabled={selectionDisabled || !selectable}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
