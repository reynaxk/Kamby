/**
 * The fixed, hardcoded set of chains Kamby trades on — deliberately not a dynamic registry
 * loaded from config (see docs/CHAIN_ADAPTERS.md). Every other place that needs to go from a
 * URL slug to a CAIP-2 identifier, a numeric chain id, or back again should import from here
 * rather than hand-rolling its own copy of this mapping — apps/web's routing, apps/api's DTO
 * validation, and each app's env parsing all key off this same table.
 *
 * `slug` is the short, share-friendly form used in URLs ("base", "arbitrum"). `identifier` is
 * the CAIP-2 form (see ChainSchema in ./chain) stored on `Chain.identifier` and returned to
 * clients as a market's public chain identity. `numericId` is the real EVM chain id, used only
 * where the wire format demands a number (wallet RPC calls, LI.FI's fromChain/toChain, DTOs).
 */
export const CHAIN_REGISTRY = {
  base: {
    identifier: 'eip155:8453',
    numericId: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
  },
  arbitrum: {
    identifier: 'eip155:42161',
    numericId: 42161,
    name: 'Arbitrum',
    nativeSymbol: 'ETH',
  },
  bnb: {
    identifier: 'eip155:56',
    numericId: 56,
    name: 'BNB Chain',
    nativeSymbol: 'BNB',
  },
  ethereum: {
    identifier: 'eip155:1',
    numericId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
  },
} as const;

export type ChainSlug = keyof typeof CHAIN_REGISTRY;

export const SUPPORTED_CHAIN_SLUGS = Object.keys(CHAIN_REGISTRY) as ChainSlug[];

export const SUPPORTED_CHAIN_IDS = SUPPORTED_CHAIN_SLUGS.map((slug) => CHAIN_REGISTRY[slug].numericId);

/** Which chain a caller gets when it omits chainId entirely — the one back-compat default
 *  every pre-multi-chain request implicitly meant. */
export const DEFAULT_CHAIN_SLUG: ChainSlug = 'base';

export const DEFAULT_CHAIN_ID = CHAIN_REGISTRY[DEFAULT_CHAIN_SLUG].numericId;

export function isChainSlug(value: string): value is ChainSlug {
  return Object.prototype.hasOwnProperty.call(CHAIN_REGISTRY, value);
}

export function slugForChainId(chainId: number): ChainSlug | null {
  const found = SUPPORTED_CHAIN_SLUGS.find((slug) => CHAIN_REGISTRY[slug].numericId === chainId);
  return found ?? null;
}

export function slugForIdentifier(identifier: string): ChainSlug | null {
  const found = SUPPORTED_CHAIN_SLUGS.find((slug) => CHAIN_REGISTRY[slug].identifier === identifier);
  return found ?? null;
}

/** The CAIP-2 identifier for a real numeric EVM chain id — the missing sibling of
 *  slugForChainId/slugForIdentifier, added 2026-09-15 for querying `TokenMarket` by its
 *  `chain` relation. `TokenMarket.chainId` is a plain FK to `Chain.id` — Prisma's own
 *  autoincrement internal row id, NOT the real numeric EVM chain id `DEFAULT_CHAIN_ID`
 *  carries — a distinction several call sites got wrong (see the incident notes on
 *  SafetyService.assertTradable, MarketService.getToken/getHistory/getTokenTraders,
 *  WatchlistService.resolveTokenMarketId, and ActivityService.getGlobalFeed — the last one
 *  caught by test/social.e2e-spec.ts's tokenAddress-filtered assertions, not by code review,
 *  since a swallowed prisma:error console log made the empty result look like a passing
 *  "no activity yet" case rather than a broken filter). Filtering via `chain: { identifier:
 *  identifierForChainId(chainId) }` instead of a bare `chainId: chainId` sidesteps the
 *  confusion entirely by going through the relation, whose `identifier` really is this
 *  CAIP-2 string. */
export function identifierForChainId(chainId: number): string | null {
  const slug = slugForChainId(chainId);
  return slug ? CHAIN_REGISTRY[slug].identifier : null;
}
