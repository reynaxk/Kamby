/**
 * Phase 1's curated set of established Solana tokens to track in Markets/Trending/Movers/
 * Volume — see SolanaTokenMarket's own doc comment in packages/db/prisma/schema.prisma for
 * why this is a separate list/pipeline from BASE_SEED_MARKETS/BNB_SEED_MARKETS (a different
 * data source, DexScreener, not on-chain reads — there is no Solana equivalent to
 * UniswapV3PoolReader's slot0() across arbitrary AMM programs without picking one and
 * building real ingestion for it).
 *
 * Deliberately distinct from Pump.fun's bonding-curve tokens (pumpfun-ingestion.ts,
 * PumpFunToken) — this is for tokens that have already graduated to real, deep Raydium/
 * Orca/Meteora liquidity, not pre-graduation curves.
 *
 * Each mint below was verified 2026-09-24 by checking DexScreener resolves it to the real,
 * correctly-named token (not a same-symbol impersonator) with genuine liquidity — same
 * verify-before-trusting discipline as the EVM seed lists, just without an on-chain read as
 * the final step (DexScreener itself is this pipeline's source of truth, not just discovery
 * — see the schema doc comment for why that's a deliberate, accepted exception here).
 */
export interface SolanaSeedMarket {
  mintAddress: string;
}

export const SOLANA_SEED_MARKETS: SolanaSeedMarket[] = [
  { mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }, // BONK — $429K liquidity, $1.2M 24h volume
  { mintAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' }, // WIF (dogwifhat) — $6.63M liquidity
  { mintAddress: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' }, // JUP (Jupiter) — $2.14M liquidity
  { mintAddress: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL' }, // JTO (Jito) — $1.34M liquidity
  { mintAddress: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' }, // PYTH (Pyth Network) — $412K liquidity
  { mintAddress: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' }, // RAY (Raydium) — $7.08M liquidity
];
