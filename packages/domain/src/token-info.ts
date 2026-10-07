/** Chains the token-info endpoint accepts: the EVM chain slugs Kamby trades on, plus Solana. */
export const TOKEN_INFO_CHAINS = ['base', 'bnb', 'solana'] as const;
export type TokenInfoChain = (typeof TOKEN_INFO_CHAINS)[number];

/**
 * A coin's own links and blurb for the "About" card. Project-submitted data from
 * GeckoTerminal (DexScreener as a fallback), not something Kamby verifies — the UI says so.
 * Every URL is already checked to be https (and the right host for X/Telegram/Discord).
 */
export interface TokenInfo {
  websites: string[];
  twitterUrl: string | null;
  telegramUrl: string | null;
  discordUrl: string | null;
  description: string | null;
  source: 'geckoterminal' | 'dexscreener' | null;
}

export function emptyTokenInfo(): TokenInfo {
  return { websites: [], twitterUrl: null, telegramUrl: null, discordUrl: null, description: null, source: null };
}

/** A coin's trading stats from its DexScreener pools (2026-10-07: "put more info on every coin").
 *  Price changes are the chart pool's; volume and trade counts add up the coin's real pools
 *  (each at least $1K liquidity, so spam pools can't inflate them). */
export interface TokenStats {
  priceChangePct: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volumeUsd: { m5: number; h1: number; h6: number; h24: number };
  txns24h: { buys: number; sells: number };
  txns1h: { buys: number; sells: number };
  fdvUsd: number | null;
  /** When the coin's oldest real pool was created (unix ms) — its trading age. */
  pairCreatedAtMs: number | null;
  atIso: string;
}

/** The latest price for the chart's "Live" timeframe. */
export interface LivePrice {
  priceUsd: number;
  atIso: string;
  /** The pool this price is from — the coin's chart pool, so every timeframe shows one market
   *  (2026-10-05: Live and the candle widths read different pools and disagreed). */
  poolAddress?: string;
}
