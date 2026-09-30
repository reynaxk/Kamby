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

/** The latest price for the chart's "Live" timeframe. */
export interface LivePrice {
  priceUsd: number;
  atIso: string;
}
