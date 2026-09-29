/** Where a curated Solana market row links to — /solana resolves `mint` against Kamby's own
 *  Solana market list and falls back to SOL for anything else (see app/solana/page.tsx). */
export function solanaMarketHref(mint: string): string {
  return `/solana?mint=${encodeURIComponent(mint)}`;
}
