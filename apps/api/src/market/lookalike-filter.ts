import { isCuratedMarket, type MarketSummary } from '@kamby/domain';

/** "$WIF", " wif " and "WIF" are the same ticker to a reader. */
function normalizedSymbol(symbol: string | null): string | null {
  const normalized = symbol?.trim().replace(/^\$+/, '').toLowerCase();
  return normalized ? normalized : null;
}

function isHandPicked(market: MarketSummary): boolean {
  // Every Solana market is from the curated SolanaTokenMarket list; EVM markets are either
  // seed-list (curated) or promoted by pool discovery.
  return market.chainIdentifier === 'solana' || isCuratedMarket(market.chainIdentifier, market.tokenAddress);
}

function preferred(a: MarketSummary, b: MarketSummary): MarketSummary {
  const volume = (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1);
  if (volume !== 0) return volume > 0 ? b : a;
  return (b.liquidityUsd ?? -1) > (a.liquidityUsd ?? -1) ? b : a;
}

/**
 * Hides copycat tokens from browsable lists — found 2026-09-30: pool discovery had promoted
 * 7 different "Cetus Protocol" tokens, 6 "Doppler Finance" and two fake "Aave" beside the
 * real one, and a buyer can't tell which "$AAVE" is real from a list row.
 *
 * Per chain, among markets sharing a ticker: if any is hand-picked (seed list / curated
 * Solana), only the hand-picked ones show; otherwise only the single most-traded discovered
 * one does (24h volume, then liquidity). Markets without a symbol pass through untouched.
 * Order of the surviving markets is preserved.
 *
 * Deliberately a display filter, not deletion: a hidden market still resolves by its exact
 * contract address (token page, address search), and a real token that loses a tie today
 * reappears once it out-trades the copies.
 */
export function hideLookalikes(markets: MarketSummary[]): MarketSummary[] {
  const winners = new Map<string, MarketSummary[]>();
  for (const market of markets) {
    const symbol = normalizedSymbol(market.symbol);
    if (!symbol) continue;
    const key = `${market.chainIdentifier}:${symbol}`;
    const current = winners.get(key);
    if (!current) {
      winners.set(key, [market]);
    } else if (isHandPicked(market)) {
      winners.set(key, isHandPicked(current[0]!) ? [...current, market] : [market]);
    } else if (!isHandPicked(current[0]!)) {
      winners.set(key, [preferred(current[0]!, market)]);
    }
  }
  const keep = new Set([...winners.values()].flat());
  return markets.filter((market) => !normalizedSymbol(market.symbol) || keep.has(market));
}
