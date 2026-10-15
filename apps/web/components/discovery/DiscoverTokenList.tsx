'use client';

import { XxxRiskFeedRow } from './feeds/XxxRiskFeedRow';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { PulseChat } from '@/components/pulse/PulseChat';
import { useTranslations } from 'next-intl';
import { useSteadyOrder } from '@/lib/use-steady-order';
import { WatchlistTokens } from './WatchlistTokens';
import { ChainFilter, matchesChain, useChainFilter } from './ChainFilter';
export type PrimaryTab = 'watchlist' | 'alerts' | 'tokens' | 'leaderboard' | 'traders';

const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'traders', label: 'Pulse' },
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
  roomy = false,
}: {
  activeTab: PrimaryTab;
  onChange: (tab: PrimaryTab) => void;
  /** The app look on desktop too (desktop Home, 2026-10-15) — the terminal keeps its compact tabs. */
  roomy?: boolean;
}) {
  const tU = useTranslations('ui');
  const tLists = useTranslations('lists');
  return (
    <nav
      aria-label={tU('terminalNavigation_312e')}
      className={cn(
        'flex items-center gap-4 overflow-x-auto border-b border-line px-1 pb-2 max-md:gap-0 max-md:border-white/10 max-md:px-0 max-md:pb-0',
        roomy && 'md:gap-0 md:border-white/10 md:px-2 md:pb-0',
      )}
    >
      {PRIMARY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative shrink-0 font-display text-sm font-semibold transition-colors max-md:flex-1 max-md:py-3',
            roomy ? 'md:px-5 md:py-3.5' : 'md:font-mono md:text-[0.62rem] md:font-medium md:uppercase md:tracking-tight',
            activeTab === tab.id ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900',
            // Alerts aren't built yet — not worth a tab on the phone app.
            tab.id === 'alerts' && 'max-md:hidden',
            // Watchlist is the phone Home's first tab (like fomo); the desktop has its own page.
            tab.id === 'watchlist' && 'md:hidden',
          )}
        >
          {tLists(tab.id)}
          {activeTab === tab.id && <span aria-hidden className={cn('absolute inset-x-5 -bottom-px h-0.5 rounded-full bg-accent', !roomy && 'md:hidden')} />}
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
 * - Crypto: the majors' (CRYPTO_MAJORS) spot prices; a row selects the market it trades as.
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
  pageScroll = false,
}: {
  feeds: MarketFeedSnapshot;
  selectedKey: string | null;
  onSelect: (market: MarketSummary) => void;
  selectionDisabled: boolean;
  activePrimaryTab?: PrimaryTab;
  onPrimaryTabChange?: (tab: PrimaryTab) => void;
  showPrimaryNav?: boolean;
  /** Phone Home (2026-10-10, like fomo): the whole page scrolls and the tabs stick under the
   *  top bar, instead of the list scrolling inside its own box. */
  pageScroll?: boolean;
}) {
  const tL = useTranslations('labels');
  const tU = useTranslations('ui');
  const tLists = useTranslations('lists');
  const router = useRouter();
  const openSolana = useCallback((market: MarketSummary) => router.push(solanaMarketHref(market.tokenAddress)), [router]);
  const [uncontrolledPrimaryTab, setUncontrolledPrimaryTab] = useState<PrimaryTab>('tokens');
  const [tokenTab, setTokenTab] = useState<MarketFeedTab>('trending');
  const primaryTab = activePrimaryTab ?? uncontrolledPrimaryTab;
  const setPrimaryTab = onPrimaryTabChange ?? setUncontrolledPrimaryTab;
  const tabsAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pageScroll || primaryTab !== 'traders' || window.innerWidth >= 768) return;
    tabsAnchorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [pageScroll, primaryTab]);

  const trendingRows = useSteadyOrder(uniqueMarkets(feeds.trending.markets), (m) => `${m.chainIdentifier}:${m.tokenAddress}`);
  const bondingRows = useSteadyOrder(feeds.bonding.tokens, (t) => t.mintAddress);

  const [chainFilter, setChainFilter] = useChainFilter();
  const solanaShown = chainFilter === 'all' || chainFilter === 'solana';
  const tokenChips = (
          <div role="tablist" aria-label={tU('marketFeeds_b66a')} className={cn('flex gap-2 overflow-x-auto px-1 pb-0.5 max-md:px-4 max-md:pt-2', pageScroll && 'md:px-3 md:pt-3')}>
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
                  'shrink-0 rounded-full px-3 py-1.5 font-display text-xs font-semibold transition-colors',
                  !pageScroll && 'md:rounded-none md:px-0 md:py-0 md:font-mono md:text-[0.58rem] md:font-normal md:uppercase md:tracking-tight',
                  tokenTab === t.id
                    ? cn('bg-accent/10 text-accent ring-1 ring-inset ring-accent/30', !pageScroll && 'md:bg-transparent md:text-ink-900 md:ring-0')
                    : 'text-ink-400 hover:text-ink-600',
                )}
              >
                {tLists(t.id)}
              </button>
            ))}
          </div>
  );

  const marketRow = (market: FeedMarket) => {
    const key = `${market.chainIdentifier}:${market.tokenAddress}`;
    const isSolana = market.chainIdentifier === 'solana';
    const selectable = slugForIdentifier(market.chainIdentifier) !== null;
    return (
      <SelectableTokenRow
        key={key}
        market={market}
        selected={key === selectedKey}
        onSelect={isSolana ? openSolana : onSelect}
        disabled={isSolana ? false : selectionDisabled || !selectable}
        isNew={market.listing === 'new'}
      />
    );
  };

  const openCrypto = (price: CryptoPrice) => {
    const target = CRYPTO_TRADE_TARGETS[price.symbol] as (typeof CRYPTO_TRADE_TARGETS)[keyof typeof CRYPTO_TRADE_TARGETS] | undefined;
    if (!target) return;
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

  const graduatedMarkets = uniqueMarkets(feeds.graduated.markets).filter((m) => matchesChain(chainFilter, m.chainIdentifier));
  const graduatedPumpfun = solanaShown ? feeds.graduated.pumpfun : [];
  const tabContent: Record<MarketFeedTab, ReactNode> = {
    trending: list(trendingRows.filter((m) => matchesChain(chainFilter, m.chainIdentifier)).map(marketRow), tU('nothingTrendingYet_a318')),
    trenches: list(
      (solanaShown ? feeds.trenches.tokens : []).map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} />),
      tU('noNewPumpFunLaunches_09ad'),
    ),
    bonding: list(
      (solanaShown ? bondingRows : []).map((token) => <PumpFunFeedRow key={token.mintAddress} token={token} emphasizeProgress />),
      tU('nothingCloseToGraduatingRight_e349'),
    ),
    graduated: (
      <>
        {graduatedMarkets.length > 0 && <SectionLabel>New pools</SectionLabel>}
        {graduatedMarkets.map(marketRow)}
        {graduatedPumpfun.length > 0 && <SectionLabel>{tU('graduatedFromPumpFun_9d58')}</SectionLabel>}
        {graduatedPumpfun.map((token) => (
          <PumpFunFeedRow key={token.mintAddress} token={token} />
        ))}
        {graduatedMarkets.length === 0 && graduatedPumpfun.length === 0 && (
          <p className="col-span-full p-3 font-body text-xs text-ink-400">{tU('nothingHasGraduatedRecently_4271')}</p>
        )}
      </>
    ),
    xxxrisk: (
      <>
        <p role="note" className="col-span-full mx-1 my-1 rounded-lg border border-down/40 bg-down/10 px-2 py-1.5 font-body text-[0.65rem] text-ink-900">
          {tL('xxxRiskNote')}
        </p>
        {(solanaShown ? feeds.xxxrisk?.tokens ?? [] : []).length === 0 ? (
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
    <div className={cn('flex h-full flex-col gap-1.5', pageScroll && 'max-md:h-auto')}>
      {/* Phones: opening Pulse scrolls here so the tabs stick at the top and the chat fills the
          rest of the screen (its composer was ending up behind the tab bar, 2026-10-13). */}
      {pageScroll && <div ref={tabsAnchorRef} aria-hidden className="max-md:scroll-mt-[calc(env(safe-area-inset-top)+3rem)]" />}
      <div className={cn(pageScroll && 'kamby-rise kamby-rise-3 max-md:sticky max-md:top-[calc(env(safe-area-inset-top)+3rem)] max-md:z-30 max-md:bg-bg max-md:pb-1')}>
      {showPrimaryNav && <TerminalPrimaryNav activeTab={primaryTab} onChange={setPrimaryTab} roomy={pageScroll} />}
      {primaryTab === 'tokens' && pageScroll && tokenChips}
      {primaryTab === 'tokens' && pageScroll && tokenTab !== 'crypto' && <ChainFilter value={chainFilter} onChange={setChainFilter} className="pt-1.5 md:px-3 md:pb-1" />}
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col gap-1.5', pageScroll && 'max-md:flex-none')}>
        {primaryTab === 'tokens' && !pageScroll && tokenChips}
        {primaryTab === 'tokens' && !pageScroll && tokenTab !== 'crypto' && <ChainFilter value={chainFilter} onChange={setChainFilter} />}

        {primaryTab === 'leaderboard' ? (
          <div className="min-h-0 flex-1">
            <LeaderboardSidebar />
          </div>
        ) : primaryTab === 'traders' ? (
          // Pulse, the worldwide chat (2026-10-11) — replaced the old Feed list (owner: "not
          // useful"). On the phone Home it fills the screen under the sticky tabs.
          <div className="min-h-0 flex-1">
            <PulseChat className={pageScroll ? 'h-[calc(100dvh-env(safe-area-inset-top)-6.5rem)] md:h-full' : 'h-full'} />
          </div>
        ) : primaryTab === 'watchlist' ? (
          <div className="min-h-0 flex-1">
            <WatchlistTokens />
          </div>
        ) : primaryTab === 'alerts' ? (
          <div className="min-h-0 flex-1 rounded-2xl border border-line bg-surface">
            <EmptyState
              title={tU('alertsArenTBuiltYet_6666')}
              detail="Price/volume alerts are planned but don't exist yet — nothing to show here honestly."
            />
          </div>
        ) : (
          <div className={cn('terminal-token-list min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line bg-surface max-md:rounded-none max-md:border-0 max-md:bg-transparent', pageScroll && 'kamby-cascade max-md:flex-none max-md:overflow-visible')}>
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
