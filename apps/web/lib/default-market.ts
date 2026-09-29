import { isCuratedMarket, slugForIdentifier, type MarketSummary, type TrendingToken } from '@kamby/domain';

function isSafeDefault(market: MarketSummary): boolean {
  // EVM-routable (the terminal's chart/trade flow is EVM-only) and hand-picked. Pool discovery
  // auto-publishes anything clearing a $10K liquidity floor with no wash-trade filtering, so a
  // discovered token can trend on fake volume — the homepage's first impression shouldn't be one.
  return slugForIdentifier(market.chainIdentifier) !== null && isCuratedMarket(market.chainIdentifier, market.tokenAddress);
}

/** The Discover terminal's default selection: a random pick among currently-trending curated
 *  markets, so the homepage doesn't open on the same token every time. Falls back to the
 *  top-ranked curated market, then to any selectable market, so there's always something to
 *  show while the trending feed is empty. `random` is injectable for tests. */
export function pickDefaultMarket(
  ranked: MarketSummary[],
  trending: TrendingToken[],
  random: () => number = Math.random,
): MarketSummary | undefined {
  const candidates = trending.map((t) => t.market).filter(isSafeDefault);
  if (candidates.length > 0) return candidates[Math.floor(random() * candidates.length)];
  return ranked.find(isSafeDefault) ?? ranked.find((m) => slugForIdentifier(m.chainIdentifier) !== null);
}
