import { CHAIN_REGISTRY, DEFAULT_CHAIN_SLUG, slugForIdentifier, type TokenTraderConnection } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { AutoRefresh } from '@/components/market/AutoRefresh';
import { EmptyState } from '@/components/market/EmptyState';
import { MarketHeader } from '@/components/market/MarketHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TokenCard } from '@/components/market/TokenCard';
import { ActivityFeedTabs } from '@/components/social/ActivityFeedTabs';
import { ActivityCard } from '@/components/social/ActivityCard';
import { TopTraders } from '@/components/social/TopTraders';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { DiscoverTerminal } from '@/components/discovery/DiscoverTerminal';
import { FreshCoinsBubbles } from '@/components/discovery/FreshCoinsBubbles';
import { PersonalizedSection } from '@/components/discovery/PersonalizedSection';
import { RisingSection } from '@/components/discovery/RisingSection';
import { SavedSearches } from '@/components/discovery/SavedSearches';
import { WhatsMissedSection } from '@/components/discovery/WhatsMissedSection';
import { fetchDiscoverMarkets, fetchSearch, fetchTokenHistory } from '@/lib/market-api';
import {
  fetchGlobalActivity,
  fetchTopTraders,
  fetchTraderSearch,
  fetchTrending,
} from '@/lib/social-api';
import { fetchActiveTraders, fetchLargeTrades, fetchRising, fetchTokenTraders } from '@/lib/discovery-api';
import { settledOr } from '@/lib/settled-fetch';

const EMPTY_TOKEN_TRADER_CONNECTION: TokenTraderConnection = {
  uniqueTraders24h: null,
  recentTraders: [],
  activeTraders: [],
  recentLargeTrades: [],
  watcherCount: 0,
};

export const revalidate = 15;

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const search = searchParams.search?.trim() || undefined;

  // Each section below is independent — a backend blip on one (e.g. Large trades) must
  // never take out an otherwise-fine page. `settledOr` degrades a failed section to its
  // own empty state (same as "no data yet") instead of failing this whole Promise.all,
  // which previously crashed the entire homepage on any single section's fetch error.
  const [
    ranked,
    movers,
    byVolume,
    activity,
    trending,
    topTraders,
    traderResults,
    activeTraders,
    largeTrades,
    rising,
  ] = await Promise.all([
    // Ranked discovery (computeDiscoveryScore) deliberately excludes any market with no
    // 24h volume/momentum data yet — real, correct behavior for "what's trending," but it
    // means an explicit search for a token by name/symbol found NOTHING for any market that
    // hadn't accumulated trade history, even an exact match (confirmed live 2026-09-17: a
    // freshly-seeded BNB market, zero volume so far, was invisible to search even though it
    // was genuinely tracked and tradable). `fetchSearch` — the dedicated, ranking-gate-free
    // endpoint that already existed but was never actually wired up here — is what an
    // explicit search should hit instead; the ranked feed stays ranked-only when browsing.
    search ? settledOr(fetchSearch(search, 20), []) : settledOr(fetchDiscoverMarkets({ sort: 'score', limit: 20 }), []),
    settledOr(fetchDiscoverMarkets({ sort: 'priceChange', limit: 3, search }), []),
    settledOr(fetchDiscoverMarkets({ sort: 'volume', limit: 3, search }), []),
    settledOr(fetchGlobalActivity({ limit: 20 }), { items: [], nextCursor: null }),
    settledOr(fetchTrending(6), []),
    settledOr(fetchTopTraders(4), []),
    search ? settledOr(fetchTraderSearch(search, 5), []) : Promise.resolve([]),
    settledOr(fetchActiveTraders(4), []),
    settledOr(fetchLargeTrades(4), []),
    settledOr(fetchRising(6), { tokens: [], traders: [] }),
  ]);

  // The in-place terminal hero's default selection — see components/discovery/
  // DiscoverTerminal.tsx's own doc comment. Fetched server-side (not via the client
  // lib/market-client.ts etc. functions, which are only for later client-driven reselection)
  // so the default token's chart/activity/traders are already real on first paint, no
  // loading flash. `ranked[0]` since it's the largest already-fetched list (limit: 20 vs.
  // trending's 6 and movers/byVolume's 3) and the same ranking already anchoring the
  // existing "What's moving" section below.
  const defaultMarket = !search && ranked.length > 0 ? ranked[0] : undefined;
  const defaultChainId = defaultMarket
    ? CHAIN_REGISTRY[slugForIdentifier(defaultMarket.chainIdentifier) ?? DEFAULT_CHAIN_SLUG].numericId
    : CHAIN_REGISTRY[DEFAULT_CHAIN_SLUG].numericId;
  const [heroCandles, heroActivity, heroTraders] = defaultMarket
    ? await Promise.all([
        settledOr(fetchTokenHistory(defaultMarket.tokenAddress, '1D', defaultChainId), []),
        settledOr(
          fetchGlobalActivity({ tokenAddress: defaultMarket.tokenAddress, limit: 10 }),
          { items: [], nextCursor: null },
        ),
        settledOr(
          fetchTokenTraders(defaultMarket.tokenAddress, defaultChainId, 8),
          EMPTY_TOKEN_TRADER_CONNECTION,
        ),
      ])
    : [[], { items: [], nextCursor: null }, EMPTY_TOKEN_TRADER_CONNECTION];

  return (
    // kamby-void — see globals.css's own doc comment. Discover is one of the two
    // highest-visibility pages this theme rolled out to on 2026-09-15 (Market detail is
    // the other); the rest of the product still runs the original light/dark palette.
    <div className="kamby-void min-h-screen bg-bg">
      <AutoRefresh intervalSeconds={30} />
      <MarketHeader searchValue={search} />
      {!search && (
        <div className="mx-auto max-w-[1600px] px-3 pt-6 sm:px-4">
          <DiscoverTerminal
            ranked={ranked}
            trending={trending}
            movers={movers}
            byVolume={byVolume}
            initialMarket={defaultMarket ?? null}
            initialTimeframe="1D"
            initialCandles={heroCandles}
            initialActivity={heroActivity.items}
            initialTraders={heroTraders}
          />
        </div>
      )}
      <main className="mx-auto max-w-6xl px-6 py-10">
        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">New coins</h2>
            <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
              Freshly launched Pump.fun tokens, sized by how close each is to graduating. Click one to
              open it on Solscan.
            </p>
            <div className="mt-5">
              <FreshCoinsBubbles />
            </div>
          </section>
        )}

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
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Traders</h2>
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

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Live activity
            </h2>
            <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
              Real indexed trades from tracked markets, as they happen. See who&apos;s buying and
              selling right now.
            </p>
            <div className="mt-5">
              <ActivityFeedTabs globalItems={activity.items} globalCursor={activity.nextCursor} />
            </div>
          </section>
        )}

        <section className="mb-12">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
            What&apos;s moving
          </h2>
          <p className="mt-1 max-w-xl font-body text-sm text-ink-600">
            Ranked by the Discovery Score — a transparent mix of volume, momentum, and liquidity.
            See how it&apos;s computed in the token detail page.
          </p>
          <div className="mt-5">
            <MarketTable markets={ranked} />
          </div>
        </section>

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Trending</h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Ranked by real trading activity — unique traders and trade count, not just volume. See
              docs/SOCIAL.md#trending.
            </p>
            <div className="mt-5">
              {trending.length === 0 ? (
                <EmptyState title="Nothing has cleared the trending thresholds yet" />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {trending.map((item) => (
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
              Top traders
            </h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Most active by real 24h volume — not a profit claim.
            </p>
            <div className="mt-5">
              {topTraders.length === 0 ? (
                <EmptyState title="No trader has cleared the activity floor yet" />
              ) : (
                <TopTraders traders={topTraders} />
              )}
            </div>
          </section>
        )}

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
              Active traders
            </h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Most 24h trades — a different ranking than Top Traders above, which is by volume.
              Still not a profit claim.
            </p>
            <div className="mt-5">
              {activeTraders.length === 0 ? (
                <EmptyState title="No trader has cleared the activity floor yet" />
              ) : (
                <TopTraders traders={activeTraders} />
              )}
            </div>
          </section>
        )}

        {!search && (
          <section className="mb-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
              Large trades
            </h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Recent confirmed trades at or above the large-trade threshold, across every tracked
              market.
            </p>
            <div className="mt-5">
              {largeTrades.length === 0 ? (
                <EmptyState title="No large trades yet" />
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
            <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Rising</h2>
            <p className="mt-1 font-body text-sm text-ink-600">
              Tokens that just started trending, and traders moving well above their usual pace.
            </p>
            <div className="mt-5">
              <RisingSection tokens={rising.tokens} traders={rising.traders} />
            </div>
          </section>
        )}

        <section className="mb-12">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">
            Biggest movers
          </h2>
          <p className="mt-1 font-body text-sm text-ink-600">
            Biggest 24h movers among tracked markets.
          </p>
          <div className="mt-5">
            {movers.length === 0 ? (
              <EmptyState title="No movement data yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {movers.map((market) => (
                  <TokenCard key={market.tokenAddress} market={market} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold tracking-tight text-ink-900">Volume</h2>
          <p className="mt-1 font-body text-sm text-ink-600">
            Highest 24h trading volume among tracked markets.
          </p>
          <div className="mt-5">
            {byVolume.length === 0 ? (
              <EmptyState title="No volume data yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {byVolume.map((market) => (
                  <TokenCard key={market.tokenAddress} market={market} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
