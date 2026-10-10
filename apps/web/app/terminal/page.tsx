import {
  CHAIN_REGISTRY,
  DEFAULT_CHAIN_SLUG,
  emptyMarketFeeds,
  slugForIdentifier,
  type TokenTraderConnection,
} from '@kamby/domain';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { EmptyState } from '@/components/market/EmptyState';
import { MarketHeader } from '@/components/market/MarketHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TokenCard } from '@/components/market/TokenCard';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { DiscoverTerminal } from '@/components/discovery/DiscoverTerminal';
import { PersonalizedSection } from '@/components/discovery/PersonalizedSection';
import { RisingSection } from '@/components/discovery/RisingSection';
import { SavedSearches } from '@/components/discovery/SavedSearches';
import { WhatsMissedSection } from '@/components/discovery/WhatsMissedSection';
import { ActivityCard } from '@/components/social/ActivityCard';
import { TopTraders } from '@/components/social/TopTraders';
import { fetchDiscoverMarkets, fetchMarketFeeds, fetchSearch, fetchTokenHistory } from '@/lib/market-api';
import { fetchGlobalActivity, fetchTraderSearch, fetchTrending } from '@/lib/social-api';
import { fetchTokenTraders } from '@/lib/discovery-api';
import { pickDefaultMarket } from '@/lib/default-market';
import { settledOr, settledWithin } from '@/lib/settled-fetch';
import { SignedInOnly } from '@/components/landing/SignedInOnly';
import { getTranslations } from 'next-intl/server';

// The terminal fetches anything not ready by then itself — waiting longer only delays first
// paint (2026-10-05: the page took ~2s before sending a byte).
const HERO_BUDGET_MS = 400;

const EMPTY_TOKEN_TRADER_CONNECTION: TokenTraderConnection = {
  uniqueTraders24h: null,
  recentTraders: [],
  activeTraders: [],
  recentLargeTrades: [],
  watcherCount: 0,
  buyCount24h: 0,
  sellCount24h: 0,
  buyerCount24h: 0,
  sellerCount24h: 0,
};

export const revalidate = 15;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const tU = await getTranslations('ui');
  const search = searchParams.search?.trim() || undefined;

  // Each section below is independent — a backend blip on one (e.g. Large trades) must
  // never take out an otherwise-fine page. `settledOr` degrades a failed section to its
  // own empty state (same as "no data yet") instead of failing this whole Promise.all,
  // which previously crashed the entire homepage on any single section's fetch error.
  const [
    feedsResult,
    searchResults,
    movers,
    byVolume,
    trending,
    topTraders,
    traderResults,
    activeTraders,
    largeTrades,
    rising,
  ] = await Promise.all([
    // Browsing: the terminal's five feed tabs (Trending/Trenches/Bonding/Graduated/Crypto),
    // server-rendered here and kept live in the browser over one stream (lib/market-feeds.ts)
    // — which is why this page no longer auto-refreshes itself.
    search ? Promise.resolve(null) : settledOr(fetchMarketFeeds(), null),
    // Ranked discovery (computeDiscoveryScore) deliberately excludes any market with no
    // 24h volume/momentum data yet — real, correct behavior for "what's trending," but it
    // means an explicit search for a token by name/symbol found NOTHING for any market that
    // hadn't accumulated trade history, even an exact match (confirmed live 2026-09-17: a
    // freshly-seeded BNB market, zero volume so far, was invisible to search even though it
    // was genuinely tracked and tradable). `fetchSearch` — the dedicated, ranking-gate-free
    // endpoint — is what an explicit search hits instead.
    search ? settledOr(fetchSearch(search, 20), []) : Promise.resolve([]),
    search ? settledOr(fetchDiscoverMarkets({ sort: 'priceChange', limit: 50, search }), []) : Promise.resolve([]),
    search ? settledOr(fetchDiscoverMarkets({ sort: 'volume', limit: 50, search }), []) : Promise.resolve([]),
    // 12, not 6: the top few trending slots are usually majors (WETH/cbBTC/...), so a
    // shallower list starved both the Trending tab and pickDefaultMarket's pool of smaller
    // curated coins (ZORA/CLANKER/BRETT/TOSHI/DEGEN). The card grid below still shows 6.
    settledOr(fetchTrending(12), []),
    Promise.resolve([]),
    search ? settledOr(fetchTraderSearch(search, 5), []) : Promise.resolve([]),
    Promise.resolve([]),
    Promise.resolve([] as Awaited<ReturnType<typeof fetchGlobalActivity>>['items']),
    Promise.resolve({ tokens: [], traders: [] }),
  ]);

  // The in-place terminal hero's default selection — see components/discovery/
  // DiscoverTerminal.tsx's own doc comment. Fetched server-side (not via the client
  // lib/market-client.ts etc. functions, which are only for later client-driven reselection)
  // so the default token's chart/activity/traders are already real on first paint, no
  // loading flash. The highest-ranked *EVM* row, not simply `ranked[0]` — `ranked` now
  // merges in Solana rows too (see MarketService.discover()), which are real markets but
  // not selectable into this terminal (DiscoverTokenList's own doc comment: chart/trade
  // routing resolves chain purely through CHAIN_REGISTRY, EVM-only). A Solana row ranking
  // #1 by volume — which happens for real, e.g. JUP — previously became the default
  // selection anyway, sending its mint address to the EVM-only history/traders/activity
  // endpoints and showing "Couldn't load..." everywhere on first paint for every visitor,
  // not just a real edge case.
  // Now a random pick among trending *curated* markets — see lib/default-market.ts. The
  // highest-ranked row alone let a pool-discovered token trending on wash-traded volume
  // become every visitor's first impression.
  const feeds = feedsResult ?? emptyMarketFeeds();
  const ranked = search ? searchResults : feeds.trending.markets;
  const defaultMarket = !search ? pickDefaultMarket(ranked, trending) : undefined;
  const defaultChainId = defaultMarket
    ? CHAIN_REGISTRY[slugForIdentifier(defaultMarket.chainIdentifier) ?? DEFAULT_CHAIN_SLUG]
        .numericId
    : CHAIN_REGISTRY[DEFAULT_CHAIN_SLUG].numericId;
  // The default coin's panels get a time budget: whatever isn't ready in HERO_BUDGET_MS ships
  // as `undefined` and DiscoverTerminal fetches it in the browser, so no visitor waits on a
  // cold traders/activity query (see settledWithin).
  const [heroCandles, heroActivity, heroTraders] = defaultMarket
    ? await Promise.all([
        settledWithin(fetchTokenHistory(defaultMarket.tokenAddress, '1D', defaultChainId), HERO_BUDGET_MS),
        settledWithin(fetchGlobalActivity({ tokenAddress: defaultMarket.tokenAddress, chainId: defaultChainId, limit: 10 }), HERO_BUDGET_MS),
        settledWithin(fetchTokenTraders(defaultMarket.tokenAddress, defaultChainId, 8), HERO_BUDGET_MS),
      ])
    : [[], { items: [], nextCursor: null }, EMPTY_TOKEN_TRADER_CONNECTION];

  return (
    // Signed-in only since 2026-10-04 (user request): new visitors land on "/" (the landing
    // page) and reach the terminal by signing in. Coin pages stay public for shared links.
    <SignedInOnly>
      {/* kamby-void — see globals.css's own doc comment. Discover is one of the two
          highest-visibility pages this theme rolled out to on 2026-09-15 (Market detail is
          the other); the rest of the product still runs the original light/dark palette. */}
      <div className="kamby-void kamby-terminal min-h-screen bg-bg">
        <MarketHeader searchValue={search} wide />
        {!search && (
          <div className="mx-auto max-w-[1920px] px-2 pt-2 sm:px-3">
            <DiscoverTerminal
              feeds={feeds}
              initialMarket={defaultMarket ?? null}
              shuffleOnMount={!search}
              initialTimeframe="1D"
              initialCandles={heroCandles}
              initialActivity={heroActivity?.items}
              initialTraders={heroTraders}
            />
          </div>
        )}
        {search && (
          <main className="mx-auto max-w-6xl px-6 py-10">
            {!search && <WhatsMissedSection />}

            {search && (
              <p className="mb-3 font-body text-sm text-ink-600">
                Showing results for{' '}
                <span className="font-semibold text-ink-900">&ldquo;{search}&rdquo;</span>
              </p>
            )}
            <SavedSearches currentSearch={search} />

            {search && traderResults.length > 0 && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('traders_d5d8')}
                </h2>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {traderResults.map((trader) => (
                    <Link key={trader.address} href={`/trader/${trader.address}`} className="block">
                      <Surface className="p-4 transition-colors hover:border-accent/50 hover:bg-surface-raised">
                        <TraderIdentity
                          address={trader.address}
                          displayName={trader.username}
                          avatarUrl={trader.avatarUrl}
                        />
                      </Surface>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {!search && <PersonalizedSection />}

            <section className="mb-12">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                What&apos;s moving
              </h2>
              <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
                {tU('rankedByTheDiscoveryScore_8f1d')}
              </p>
              <div className="mt-5">
                <MarketTable markets={ranked.slice(0, 20)} />
              </div>
            </section>

            {!search && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('trending_3752')}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-600">
                  {tU('rankedByRealTradingActivity_dfe3')}
                </p>
                <div className="mt-5">
                  {trending.length === 0 ? (
                    <EmptyState title={tU('nothingHasClearedTheTrending_e4d9')} />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {trending.slice(0, 6).map((item) => (
                        <TokenCard key={item.market.tokenAddress} market={item.market} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {!search && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('topTraders_a5ee')}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-600">
                  {tU('mostActiveByReal24h_6831')}
                </p>
                <div className="mt-5">
                  {topTraders.length === 0 ? (
                    <EmptyState title={tU('noTraderHasClearedThe_2a3e')} />
                  ) : (
                    <TopTraders traders={topTraders} />
                  )}
                </div>
              </section>
            )}

            {!search && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('activeTraders_0dcb')}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-600">
                  {tU('most24hTradesADifferent_c21d')}
                  {tU('stillNotAProfitClaim_d2cc')}
                </p>
                <div className="mt-5">
                  {activeTraders.length === 0 ? (
                    <EmptyState title={tU('noTraderHasClearedThe_2a3e')} />
                  ) : (
                    <TopTraders traders={activeTraders} />
                  )}
                </div>
              </section>
            )}

            {!search && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('largeTrades_b938')}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-600">
                  {tU('recentConfirmedTradesAtOr_dbb3')}
                </p>
                <div className="mt-5">
                  {largeTrades.length === 0 ? (
                    <EmptyState title={tU('noLargeTradesYet_9bb6')} />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {largeTrades.map((item) => (
                        <ActivityCard key={item.id} activity={item} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {!search && (
              <section className="mb-12">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                  {tU('rising_4475')}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-600">
                  {tU('tokensThatJustStartedTrending_5d43')}
                </p>
                <div className="mt-5">
                  <RisingSection tokens={rising.tokens} traders={rising.traders} />
                </div>
              </section>
            )}

            <section className="mb-12">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
                {tU('biggestMovers_fb33')}
              </h2>
              <p className="mt-1 font-body text-sm text-ink-600">
                {tU('biggest24hMoversAmongTracked_e764')}
              </p>
              <div className="mt-5">
                {movers.length === 0 ? (
                  <EmptyState title={tU('noMovementDataYet_00a0')} />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {movers.slice(0, 3).map((market) => (
                      <TokenCard key={market.tokenAddress} market={market} />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">{tU('volume_bd7a')}</h2>
              <p className="mt-1 font-body text-sm text-ink-600">
                {tU('highest24hTradingVolumeAmong_3c26')}
              </p>
              <div className="mt-5">
                {byVolume.length === 0 ? (
                  <EmptyState title={tU('noVolumeDataYet_1e43')} />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {byVolume.slice(0, 3).map((market) => (
                      <TokenCard key={market.tokenAddress} market={market} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </main>
        )}
      </div>
    </SignedInOnly>
  );
}
