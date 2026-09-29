import { slugForIdentifier } from '@kamby/domain';

/** Where a curated Solana market row links to — /solana resolves `mint` against Kamby's own
 *  Solana market list and falls back to SOL for anything else (see app/solana/page.tsx). */
export function solanaMarketHref(mint: string): string {
  return `/solana?mint=${encodeURIComponent(mint)}`;
}

/** The page a Discover-style market row opens: the EVM market page for a CHAIN_REGISTRY
 *  chain, the Solana trade page for a curated Solana market, or null (not tradeable here). */
export function marketHref(chainIdentifier: string, tokenAddress: string): string | null {
  const slug = slugForIdentifier(chainIdentifier);
  if (slug) return `/market/${slug}/${tokenAddress}`;
  if (chainIdentifier === 'solana') return solanaMarketHref(tokenAddress);
  return null;
}
