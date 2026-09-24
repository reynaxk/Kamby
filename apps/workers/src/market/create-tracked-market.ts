import type { EvmChainDataProvider, UniswapV3PoolReader } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import type { Logger } from 'pino';

/** How far back a newly-tracked market's swap-ingestion cursor starts — see
 *  ingestion.ts's own MarketIngestionService.seed() for why this stays modest. Duplicated
 *  here (not imported) since it's a small, self-contained constant and importing it would
 *  create an odd dependency from this shared module back onto MarketIngestionService. */
const INITIAL_BACKFILL_BLOCKS = 3_600n; // ~2h on Base at ~2s/block

/**
 * Creates (or updates) the Token + TokenMarket + IngestionCursor rows for one real pool —
 * the exact shape MarketIngestionService.seedOneMarket already produces for a curated seed
 * list entry, extracted here so PoolDiscoveryService's promotion step (pool-discovery.ts)
 * can create a market through the identical path once a discovered pool clears its
 * liquidity floor, rather than duplicating this logic. Once a market exists this way, it's
 * indistinguishable from a seeded one — ingestSwaps() and the now-DB-driven
 * refreshPricesAndLiquidity() (see ingestion.ts) both pick it up automatically.
 *
 * Returns false (never throws) for anything short of a configuration error — same
 * "skip this one, don't crash the tick" contract every other ingestion method here follows.
 */
export async function createTrackedMarket(
  poolReader: UniswapV3PoolReader,
  tokenReader: EvmChainDataProvider,
  chainId: number,
  poolAddress: string,
  baseTokenAddress: string,
  dex: 'uniswap-v3' | 'pancakeswap-v3',
  logger: Logger,
): Promise<boolean> {
  const poolState = await poolReader.getPoolState(poolAddress);
  if (!poolState) {
    logger.warn({ pool: poolAddress }, 'Skipped tracking: pool state unreadable');
    return false;
  }

  const quoteTokenAddress =
    poolState.token0.toLowerCase() === baseTokenAddress.toLowerCase() ? poolState.token1 : poolState.token0;

  const baseToken = await upsertToken(tokenReader, chainId, baseTokenAddress);
  const quoteToken = await upsertToken(tokenReader, chainId, quoteTokenAddress);
  if (!baseToken || !quoteToken) {
    logger.warn({ pool: poolAddress }, 'Skipped tracking: token metadata unreadable');
    return false;
  }

  const tokenMarket = await prisma.tokenMarket.upsert({
    where: { chainId_pairAddress: { chainId, pairAddress: poolAddress } },
    update: { dex, feeTier: poolState.feeTier },
    create: {
      chainId,
      tokenId: baseToken.id,
      quoteTokenId: quoteToken.id,
      dex,
      pairAddress: poolAddress,
      feeTier: poolState.feeTier,
    },
  });

  const latestBlock = await poolReader.getLatestBlockNumber();
  await prisma.ingestionCursor.upsert({
    where: { tokenMarketId: tokenMarket.id },
    update: {},
    create: {
      tokenMarketId: tokenMarket.id,
      lastProcessedBlock: latestBlock > INITIAL_BACKFILL_BLOCKS ? latestBlock - INITIAL_BACKFILL_BLOCKS : 0n,
    },
  });
  return true;
}

async function upsertToken(tokenReader: EvmChainDataProvider, chainId: number, contractAddress: string) {
  const metadata = await tokenReader.getTokenMetadata(contractAddress);
  return prisma.token.upsert({
    where: { chainId_contractAddress: { chainId, contractAddress } },
    update: { symbol: metadata.symbol, name: metadata.name, decimals: metadata.decimals },
    create: {
      chainId,
      contractAddress,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals,
    },
  });
}
