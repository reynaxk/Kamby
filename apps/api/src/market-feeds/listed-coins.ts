import { prisma } from '@kamby/db';
import { CHAIN_REGISTRY, type TokenInfoChain } from '@kamby/domain';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { listed: boolean; at: number }>();

/**
 * Whether Kamby itself lists a coin — the gate in front of every free third-party API Kamby
 * proxies (GeckoTerminal, DexScreener), so arbitrary addresses can't spend those shared rate
 * budgets. EVM: any Token row on that chain. Solana: SOL, the curated Solana markets, and
 * Pump.fun coins Kamby watched graduate. Remembered for 10 minutes per coin.
 */
export async function isListedCoin(chain: TokenInfoChain, address: string): Promise<boolean> {
  const key = `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.listed;

  let listed: boolean;
  if (chain === 'solana') {
    if (address === SOL_MINT) listed = true;
    else {
      const [curated, graduated] = await Promise.all([
        prisma.solanaTokenMarket.findFirst({ where: { mintAddress: address }, select: { id: true } }),
        prisma.pumpFunToken.findFirst({ where: { mintAddress: address, complete: true }, select: { id: true } }),
      ]);
      listed = curated !== null || graduated !== null;
    }
  } else {
    const token = await prisma.token.findFirst({
      where: {
        chain: { identifier: CHAIN_REGISTRY[chain].identifier },
        contractAddress: { equals: address, mode: 'insensitive' },
      },
      select: { id: true },
    });
    listed = token !== null;
  }
  cache.set(key, { listed, at: Date.now() });
  return listed;
}

/** Test seam. */
export function resetListedCoinCache(): void {
  cache.clear();
}
