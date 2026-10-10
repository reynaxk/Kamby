'use client';

import { XxxRiskFeedRow } from './feeds/XxxRiskFeedRow';
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
import { useTranslations } from 'next-intl';
import { useSteadyOrder } from '@/lib/use-steady-order';
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
  { id: 'xxxrisk', label: 'XXXRisk' },
  { id: 'crypto', label: 'Crypto' },
];

export function TerminalPrimaryNav({
  activeTab,
  onChange,
}: {
  activeTab: PrimaryTab;
  onChange: (tab: PrimaryTab) => void;
}) {
  const tU = useTranslations('ui');
  const tLists = useTranslations('lists');
  return (
    <nav
      aria-label={tU('terminalNavigation_312e')}
      className="flex items-center gap-4 overflow-x-auto border-b border-line px-1 pb-2 max-md:gap-0 max-md:border-white/10 max-md:px-0 max-md:pb-0"
    >
      {PRIMARY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative shrink-0 font-display text-sm font-semibold transition-colors max-md:flex-1 max-md:py-3 md:font-mono md:text-[0.62rem] md:font-medium md:uppercase md:tracking-tight',
            activeTab === tab.id ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900',
            // Alerts aren't built yet — not worth a tab on the phone app.
            tab.id === 'alerts' && 'max-md:hidden',
          )}
        >
          {tLists(tab.id)}
          {activeTab === tab.id && <span aria-hidden className="absolute inset-x-5 -bottom-px h-0.5 rounded-full bg-accent md:hidden" />}
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
  const tU = useTranslations('ui');
  const tLists = useTranslations('lists');
  const router = useRouter();
  const [uncontrolledPrimaryTab, setUncontrolledPrimaryTab] = useState<PrimaryTab>('tokens');
  const [tokenTab, setTokenTab] = useState<MarketFeedTab>('trending');
  const primaryTab = activePrimaryTab ?? uncontrolledPrimaryTab;
  const setPrimaryTab = onPrimaryTabChange ?? setUncontrolledPrimaryTab;

  const trendingRows = useSteadyOrder(uniqueMarkets(feeds.trending.markets), (m) => `${m.chainIdentifier}:${m.tokenAddress}`);
  const bondingRows = useSteadyOrder(feeds.bonding.tokens, (t) => t.mintAddress);

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
    rows.length === 0 ? <p className="col-span-full p-3 font-body text-xs text-ink-400">{emptyText}</p> : rows;

  const tabContent: Record<MarketFeedTab, ReactNode> = {
    trending: list(trendingRows.map(marketRow), tU('nothingTrendingYet_a318')),
    trenches: list(
      feeds.trenches.tokens.map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} />),
      tU('noNewPumpFunLaunches_09ad'),
    ),
    bonding: list(
      bondingRows.map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} emphasizeProgress />),
      tU('nothingCloseToGraduatingRight_e349'),
    ),
    graduated: (
      <>
        {feeds.graduated.markets.length > 0 && <SectionLabel>New pools · Base &amp; BNB</SectionLabel>}
        {uniqueMarkets(feeds.graduated.markets).map(marketRow)}
        {feeds.graduated.pumpfun.length > 0 && <SectionLabel>{tU('graduatedFromPumpFun_9d58')}</SectionLabel>}
        {feeds.graduated.pumpfun.map((token) => (
          <PumpFunFeedRow key={token.mintAddress} token={token} />
        ))}
        {feeds.graduated.markets.length === 0 && feeds.graduated.pumpfun.length === 0 && (
          <p className="col-span-full p-3 font-body text-xs text-ink-400">{tU('nothingHasGraduatedRecently_4271')}</p>
        )}
      </>
    ),
    xxxrisk: (
      <>
        <p role="note" className="col-span-full mx-1 my-1 rounded-lg border border-down/40 bg-down/10 px-2 py-1.5 font-body text-[0.65rem] text-ink-900">
          Extreme risk: coins under 10 minutes old with tiny liquidity, below Kamby&rsquo;s normal safety checks. Most go to zero.
        </p>
        {(feeds.xxxrisk?.tokens ?? []).length === 0 ? (
          <p className="col-span-full p-3 font-body text-xs text-ink-400">{tU('nothingInRangeRightNow_ba3c')}</p>
        ) : (
          (feeds.xxxrisk?.tokens ?? []).map((token) => <XxxRiskFeedRow key={token.mintAddress} token={token} />)
        )}
      </>
    ),
    crypto: list(
      feeds.crypto.prices.map((price) => <CryptoFeedRow key={price.symbol} price={price} onOpen={openCrypto} />),
      tU('connectingToLivePrices_45f2'),
    ),
  };

  return (
    <div className="flex h-full flex-col gap-1.5">
      {showPrimaryNav && <TerminalPrimaryNav activeTab={primaryTab} onChange={setPrimaryTab} />}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {primaryTab === 'tokens' && (
          <div role="tablist" aria-label={tU('marketFeeds_b66a')} className="flex gap-2 overflow-x-auto px-1 pb-0.5 max-md:px-4 max-md:pt-2">
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
                  // Phones: tappable chips (2026-10-09 app redesign); desktop keeps the compact tabs.
                  'shrink-0 rounded-full px-3 py-1.5 font-display text-xs font-semibold transition-colors md:rounded-none md:px-0 md:py-0 md:font-mono md:text-[0.58rem] md:font-normal md:uppercase md:tracking-tight',
                  tokenTab === t.id ? 'bg-white/10 text-ink-900 md:bg-transparent' : 'text-ink-400 hover:text-ink-600',
                )}
              >
                {tLists(t.id)}
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
              title={tU('alertsArenTBuiltYet_6666')}
              detail="Price/volume alerts are planned but don't exist yet — nothing to show here honestly."
            />
          </div>
        ) : (
          <div className="terminal-token-list min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface max-md:rounded-none max-md:border-0 max-md:bg-transparent">
            {tabContent[tokenTab]}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row per chain+token. React keys rows by that pair, and a duplicate (WBNB arrived
 *  twice on 2026-09-30) left an orphaned row stuck at the top of every other tab. */
function uniqueMarkets(markets: FeedMarket[]): FeedMarket[] {
  const seen = new Set<string>();
  return markets.filter((m) => {
    const key = `${m.chainIdentifier}:${m.tokenAddress}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="col-span-full border-b border-line/60 bg-surface-raised/40 px-2 py-1 font-mono text-[0.55rem] uppercase tracking-wide text-ink-400">
      {children}
    </p>
  );
}
