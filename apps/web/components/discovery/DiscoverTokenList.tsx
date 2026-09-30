'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { slugForIdentifier, type CryptoPrice, type FeedMarket, type MarketFeedSnapshot, type MarketFeedTab, type MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { CRYPTO_TRADE_TARGETS } from '@/lib/crypto-markets';
import { solanaMarketHref } from '@/lib/solana-links';
import { CryptoFeedRow } from './feeds/CryptoFeedRow';
import { PumpFunFeedRow } from './feeds/PumpFunFeedRow';
import { LeaderboardSidebar } from './LeaderboardSidebar';
import { SelectableTokenRow } from './SelectableTokenRow';
import { TradersSidebar } from './TradersSidebar';
export type PrimaryTab = 'alerts' | 'tokens' | 'leaderboard' | 'traders';

const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'traders', label: 'Feed' },
];

const TOKEN_TABS: { id: MarketFeedTab; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'trenches', label: 'Trenches' },
  { id: 'bonding', label: 'Bonding' },
  { id: 'graduated', label: 'Graduated' },
  { id: 'crypto', label: 'Crypto' },
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
 * The terminal's left rail on Discover. The Tokens tab carries the five live market feeds
 * (see MarketFeedsService in apps/api), kept current by `feeds` from useMarketFeeds — no
 * polling here:
 *
 * - Trending: Kamby's ranked markets. `new` (discovered, not hand-picked) rows carry the
 *   "New" high-risk pill.
 * - Trenches / Bonding: Pump.fun coins still on the bonding curve — browse-only, progress
 *   bars move live.
 * - Graduated: Base/BNB pools Kamby started tracking in the last few days (selectable and
 *   tradeable, always "New"), then coins that just left Pump.fun's curve (open their Solana
 *   trade page).
 * - Crypto: BTC/ETH/SOL/BNB/AVAX spot prices; a row selects the market it trades as.
 *
 * EVM rows are selected into DiscoverTerminal's chart/trade flow. Solana rows can't be — that
 * flow resolves chain purely through CHAIN_REGISTRY (EVM-only), so a Solana row there would
 * silently be treated as a Base token — so they navigate to /solana?mint= instead.
 */
export function DiscoverTokenList({
  feeds,
  selectedKey,
  onSelect,
  selectionDisabled,
  activePrimaryTab,
  onPrimaryTabChange,
  showPrimaryNav = true,
}: {
  feeds: MarketFeedSnapshot;
  selectedKey: string | null;
  onSelect: (market: MarketSummary) => void;
  selectionDisabled: boolean;
  activePrimaryTab?: PrimaryTab;
  onPrimaryTabChange?: (tab: PrimaryTab) => void;
  showPrimaryNav?: boolean;
}) {
  const router = useRouter();
  const [uncontrolledPrimaryTab, setUncontrolledPrimaryTab] = useState<PrimaryTab>('tokens');
  const [tokenTab, setTokenTab] = useState<MarketFeedTab>('trending');
  const primaryTab = activePrimaryTab ?? uncontrolledPrimaryTab;
  const setPrimaryTab = onPrimaryTabChange ?? setUncontrolledPrimaryTab;

  const marketRow = (market: FeedMarket) => {
    const key = `${market.chainIdentifier}:${market.tokenAddress}`;
    const isSolana = market.chainIdentifier === 'solana';
    const selectable = slugForIdentifier(market.chainIdentifier) !== null;
    return (
      <SelectableTokenRow
        key={key}
        market={market}
        selected={key === selectedKey}
        onSelect={isSolana ? () => router.push(solanaMarketHref(market.tokenAddress)) : onSelect}
        disabled={isSolana ? false : selectionDisabled || !selectable}
        isNew={market.listing === 'new'}
      />
    );
  };

  const openCrypto = (price: CryptoPrice) => {
    const target = CRYPTO_TRADE_TARGETS[price.symbol];
    if (target.chainIdentifier === 'solana') {
      router.push(target.href);
      return;
    }
    const market = feeds.trending.markets.find(
      (m) => m.chainIdentifier === target.chainIdentifier && m.tokenAddress.toLowerCase() === target.tokenAddress.toLowerCase(),
    );
    if (market && !selectionDisabled) onSelect(market);
    else router.push(target.href);
  };

  const list = (rows: ReactNode[], emptyText: string) =>
    rows.length === 0 ? <p className="p-3 font-body text-xs text-ink-400">{emptyText}</p> : rows;

  const tabContent: Record<MarketFeedTab, ReactNode> = {
    trending: list(feeds.trending.markets.map(marketRow), 'Nothing trending yet.'),
    trenches: list(
      feeds.trenches.tokens.map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} />),
      'No new Pump.fun launches right now.',
    ),
    bonding: list(
      feeds.bonding.tokens.map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} emphasizeProgress />),
      'Nothing close to graduating right now.',
    ),
    graduated: (
      <>
        {feeds.graduated.markets.length > 0 && <SectionLabel>New pools · Base &amp; BNB</SectionLabel>}
        {feeds.graduated.markets.map(marketRow)}
        {feeds.graduated.pumpfun.length > 0 && <SectionLabel>Graduated from Pump.fun</SectionLabel>}
        {feeds.graduated.pumpfun.map((token) => (
          <PumpFunFeedRow key={token.mintAddress} token={token} />
        ))}
        {feeds.graduated.markets.length === 0 && feeds.graduated.pumpfun.length === 0 && (
          <p className="p-3 font-body text-xs text-ink-400">Nothing has graduated recently.</p>
        )}
      </>
    ),
    crypto: list(
      feeds.crypto.prices.map((price) => <CryptoFeedRow key={price.symbol} price={price} onOpen={openCrypto} />),
      'Connecting to live prices…',
    ),
  };

  return (
    <div className="flex h-full flex-col gap-1.5">
      {showPrimaryNav && <TerminalPrimaryNav activeTab={primaryTab} onChange={setPrimaryTab} />}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {primaryTab === 'tokens' && (
          <div role="tablist" aria-label="Market feeds" className="flex gap-2 overflow-x-auto px-1 pb-0.5">
            {TOKEN_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tokenTab === t.id}
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

        {primaryTab === 'leaderboard' ? (
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
            {tabContent[tokenTab]}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="border-b border-line/60 bg-surface-raised/40 px-2 py-1 font-mono text-[0.55rem] uppercase tracking-wide text-ink-400">
      {children}
    </p>
  );
}
