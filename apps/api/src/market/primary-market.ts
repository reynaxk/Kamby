import type { Prisma } from '@kamby/db';
import { seedPoolFor } from '@kamby/domain';

/**
 * Resolves a token to the one market Kamby trades, charts and prices it by. A token can have
 * more than one tracked market (found 2026-09-30: pool discovery promoted a WBNB/BNCB pool
 * beside the seed WBNB/USDC one), and "most liquid" alone could then pick a pool quoted in
 * some other memecoin — a "Buy WBNB" that asks for BNCB. So a seed-list token always resolves
 * to its seed pool when that market exists; anything else keeps the most-liquid rule.
 *
 * `find` runs the caller's own findFirst (with its own include/select) for a given `where`.
 */
export async function findPrimaryMarket<T>(
  chainIdentifier: string,
  tokenAddress: string,
  find: (where: Prisma.TokenMarketWhereInput) => Promise<T | null>,
): Promise<T | null> {
  const seedPool = seedPoolFor(chainIdentifier, tokenAddress);
  if (seedPool) {
    const seeded = await find({ chain: { identifier: chainIdentifier }, pairAddress: { equals: seedPool, mode: 'insensitive' } });
    if (seeded) return seeded;
  }
  return find({ chain: { identifier: chainIdentifier }, token: { contractAddress: { equals: tokenAddress, mode: 'insensitive' } } });
}
