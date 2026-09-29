'use client';

import { useState } from 'react';
import { slugForIdentifier, type MarketSummary, type TrendingToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { TrenchesPanel } from '@/components/terminal/TrenchesPanel';
import { LeaderboardSidebar } from './LeaderboardSidebar';
import { SelectableTokenRow } from './SelectableTokenRow';
import { TradersSidebar } from './TradersSidebar';

type TokenTab = 'markets' | 'trending' | 'movers' | 'volume' | 'trenches';
export type PrimaryTab = 'alerts' | 'tokens' | 'leaderboard' | 'traders';

const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'traders', label: 'Feed' },
];

const TOKEN_TABS: { id: TokenTab; label: string }[] = [
  { id: 'markets', label: 'Markets' },
  { id: 'trending', label: 'Trending' },
  { id: 'movers', label: 'Movers' },
  { id: 'volume', label: 'Volume' },
  { id: 'trenches', label: 'Trenches' },
];

export function TerminalPrimaryNav({
  activeTab,
  onChange,
}: {
  activeTab: PrimaryTab;
  onChange: (tab: PrimaryTab) => void;
}) {
  return (
    <nav
      aria-label="Terminal navigation"
      className="flex items-center gap-4 overflow-x-auto border-b border-line px-1 pb-2"
    >
      {PRIMARY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'shrink-0 font-mono text-[0.62rem] font-medium uppercase tracking-tight transition-colors',
            activeTab === tab.id ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900',
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

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
  activePrimaryTab,
  onPrimaryTabChange,
  showPrimaryNav = true,
}: {
  ranked: MarketSummary[];
  trending: TrendingToken[];
  movers: MarketSummary[];
  byVolume: MarketSummary[];
  selectedKey: string | null;
  onSelect: (market: MarketSummary) => void;
  selectionDisabled: boolean;
  activePrimaryTab?: PrimaryTab;
  onPrimaryTabChange?: (tab: PrimaryTab) => void;
  showPrimaryNav?: boolean;
}) {
  const [uncontrolledPrimaryTab, setUncontrolledPrimaryTab] = useState<PrimaryTab>('tokens');
  const [tokenTab, setTokenTab] = useState<TokenTab>('markets');
  const primaryTab = activePrimaryTab ?? uncontrolledPrimaryTab;
  const setPrimaryTab = onPrimaryTabChange ?? setUncontrolledPrimaryTab;
  const rowsFor: Record<Exclude<TokenTab, 'trenches'>, MarketSummary[]> = {
    markets: ranked,
    trending: trending.map((t) => t.market),
    movers,
    volume: byVolume,
  };

  return (
    <div className="flex h-full flex-col gap-1.5">
      {showPrimaryNav && <TerminalPrimaryNav activeTab={primaryTab} onChange={setPrimaryTab} />}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {primaryTab === 'tokens' && (
          <div className="flex gap-2 overflow-x-auto px-1 pb-0.5">
            {TOKEN_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setPrimaryTab('tokens');
                  setTokenTab(t.id);
                }}
                className={cn(
                  'shrink-0 font-mono text-[0.58rem] uppercase tracking-tight transition-colors',
                  tokenTab === t.id ? 'text-ink-900' : 'text-ink-400 hover:text-ink-600',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {primaryTab === 'tokens' && tokenTab === 'trenches' ? (
          <div className="min-h-0 flex-1">
            <TrenchesPanel />
          </div>
        ) : primaryTab === 'leaderboard' ? (
          <div className="min-h-0 flex-1">
            <LeaderboardSidebar />
          </div>
        ) : primaryTab === 'traders' ? (
          <div className="min-h-0 flex-1">
            <TradersSidebar />
          </div>
        ) : primaryTab === 'alerts' ? (
          <div className="min-h-0 flex-1 rounded-2xl border border-line bg-surface">
            <EmptyState
              title="Alerts aren't built yet"
              detail="Price/volume alerts are planned but don't exist yet — nothing to show here honestly."
            />
          </div>
        ) : (
          <div className="terminal-token-list min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface">
            {rowsFor[tokenTab as Exclude<TokenTab, 'trenches'>].length === 0 ? (
              <p className="p-3 font-body text-xs text-ink-400">Nothing here yet.</p>
            ) : (
              rowsFor[tokenTab as Exclude<TokenTab, 'trenches'>].map((market) => {
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
    </div>
  );
}
