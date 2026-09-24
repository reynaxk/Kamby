import { CHAIN_REGISTRY, type ChainSlug, slugForChainId } from '@kamby/domain';

/**
 * Extracted 2026-09-16 from TradePanel.tsx's own private copy, which only ever handled
 * Base — used to unblock BNB Chain going live (needed a real BscScan mapping) and to fix
 * two other spots (ActivityCard.tsx, TransactionDetail.tsx) that were independently
 * hardcoded to Basescan despite already having a real `chainId` on their own data. Solana
 * explorer links (`solscan.io`) are a separate concept entirely — SocialFeed.tsx and
 * SolanaTradePanel.tsx build those directly, untouched by this helper.
 */
const EXPLORER_BY_CHAIN_SLUG: Partial<Record<ChainSlug, { host: string; name: string }>> = {
  base: { host: 'basescan.org', name: 'Basescan' },
  bnb: { host: 'bscscan.com', name: 'BscScan' },
  ethereum: { host: 'etherscan.io', name: 'Etherscan' },
};

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const slug = slugForChainId(chainId);
  const explorer = slug ? EXPLORER_BY_CHAIN_SLUG[slug] : undefined;
  return explorer ? `https://${explorer.host}/tx/${txHash}` : null;
}

/** The name a "View on ___" link/wrong-network message should use for a given chain —
 *  e.g. "Basescan" for Base, "BscScan" for BNB Chain. Falls back to the chain's own real
 *  display name (from CHAIN_REGISTRY) with "Explorer" appended if this chain's explorer
 *  isn't in the map above yet, rather than guessing at a made-up brand name. */
export function explorerName(chainId: number): string {
  const slug = slugForChainId(chainId);
  const explorer = slug ? EXPLORER_BY_CHAIN_SLUG[slug] : undefined;
  if (explorer) return explorer.name;
  const name = slug ? CHAIN_REGISTRY[slug].name : null;
  return name ? `${name} Explorer` : 'the block explorer';
}
