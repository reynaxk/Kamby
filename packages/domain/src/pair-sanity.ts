/** Quote tokens a coin's "real" price is read against on Solana: SOL, USDC, USDT. */
export const SOLANA_STANDARD_QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

export interface PricedPair {
  priceUsd: number;
  liquidityUsd: number;
  quoteAddress?: string;
}

/**
 * The pool to trust for a coin's price, from an aggregator's (DexScreener's) list of its pools.
 * "Deepest pool wins" alone picked a mispriced Meteora JUP/BONK pool — $5,134 with $5.4M
 * "liquidity", while every JUP/SOL and JUP/USDC pool said $0.32 (found 2026-10-03, JUP at the
 * top of Trending at +1,551,127%). So:
 *  1. prefer pools quoted in a standard token (`standardQuotes`), when there are any;
 *  2. drop pools priced more than 2× away from the median price of those candidates;
 *  3. the deepest remaining pool wins.
 */
export function pickSanePair<T extends PricedPair>(pairs: readonly T[], standardQuotes?: ReadonlySet<string>): T | null {
  const valid = pairs.filter((p) => Number.isFinite(p.priceUsd) && p.priceUsd > 0);
  if (valid.length === 0) return null;
  const standard = standardQuotes ? valid.filter((p) => p.quoteAddress !== undefined && standardQuotes.has(p.quoteAddress)) : [];
  const candidates = standard.length > 0 ? standard : valid;
  const sorted = candidates.map((p) => p.priceUsd).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const sane = candidates.filter((p) => p.priceUsd <= median * 2 && p.priceUsd >= median / 2);
  return sane.reduce((a, b) => (b.liquidityUsd > a.liquidityUsd ? b : a));
}
