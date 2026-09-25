import type { EvmChainDataProvider, UniswapV3PoolReader } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import type { Logger } from 'pino';

/** How far back a newly-tracked market's swap-ingestion cursor starts — see
 *  ingestion.ts's own MarketIngestionService.seed() for why this stays modest. Duplicated
 *  here (not imported) since it's a small, self-contained constant and importing it would
 *  create an odd dependency from this shared module back onto MarketIngestionService. */
const INITIAL_BACKFILL_BLOCKS = 3_600n; // ~2h on Base at ~2s/block

const DEXSCREENER_TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens';
/** DexScreener's own chain-id string per numeric EVM chain id — a different naming
 *  convention than this codebase's CAIP-2 identifiers (e.g. BNB Chain is 'bsc' here, not
 *  'bnb', matching every DexScreener query already used to research this session's seed
 *  list). Add an entry here before a new EVM chain can get real logos. */
const DEXSCREENER_CHAIN_ID: Record<number, string> = { 8453: 'base', 56: 'bsc' };

/**
 * Best-effort token logo lookup — never a source of truth for price/liquidity/metadata
 * (see docs/MARKET_DATA.md's "never borrowed from a third party" rule), just a real image
 * URL for display. Deliberately exported for `backfillTokenLogos` (ingestion.ts) to reuse
 * on already-tracked tokens, not just newly-created ones.
 *
 * An ERC-20 contract has no on-chain "logo" field to read — ERC-20 defines symbol/name/
 * decimals, nothing image-related — so there is no honest way to populate `Token.logoUrl`
 * from a chain read the way every other field on this model is sourced. Using DexScreener
 * here is a deliberate, narrow exception to the "never trust a third party" rule: a wrong
 * or missing image carries no financial risk the way a wrong price or liquidity figure
 * would, unlike everything else this file and `ingestion.ts` compute.
 *
 * Returns `null` (never throws) on any failure — an unresolved logo is an honest empty
 * state (`SelectableTokenRow.tsx` already falls back to the token's own first letter), not
 * worth failing seeding or a whole tick over.
 */
export async function fetchTokenLogoUrl(chainId: number, contractAddress: string): Promise<string | null> {
  const dexscreenerChainId = DEXSCREENER_CHAIN_ID[chainId];
  if (!dexscreenerChainId) return null;
  try {
    const response = await fetch(`${DEXSCREENER_TOKENS_URL}/${contractAddress}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { pairs?: { chainId: string; info?: { imageUrl?: string } }[] | null };
    const match = (body.pairs ?? []).find((p) => p.chainId === dexscreenerChainId && p.info?.imageUrl);
    return match?.info?.imageUrl ?? null;
  } catch {
    return null;
  }
}

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
 *
 * `chainId` and `evmChainId` are deliberately separate parameters, not one reused value —
 * `chainId` is `Chain.id`, Postgres's own internal autoincrement row id (what Token/
 * TokenMarket's real foreign keys use), while `evmChainId` is the real numeric EVM chain id
 * (8453 for Base, 56 for BNB Chain) that `fetchTokenLogoUrl` needs to query DexScreener
 * correctly. Conflating the two was a real bug caught by this file's own test suite before
 * it shipped: passing `Chain.id` (a small autoincrement number, never a real chain id) into
 * the DexScreener lookup silently resolved to no match every time, so logos would have
 * silently never populated in production despite every other part of this feature working.
 */
export async function createTrackedMarket(
  poolReader: UniswapV3PoolReader,
  tokenReader: EvmChainDataProvider,
  chainId: number,
  evmChainId: number,
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

  const baseToken = await upsertToken(tokenReader, chainId, evmChainId, baseTokenAddress);
  const quoteToken = await upsertToken(tokenReader, chainId, evmChainId, quoteTokenAddress);
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

async function upsertToken(tokenReader: EvmChainDataProvider, chainId: number, evmChainId: number, contractAddress: string) {
  const metadata = await tokenReader.getTokenMetadata(contractAddress);
  const logoUrl = await fetchTokenLogoUrl(evmChainId, contractAddress);
  return prisma.token.upsert({
    where: { chainId_contractAddress: { chainId, contractAddress } },
    // `logoUrl: logoUrl ?? undefined` — Prisma skips an `undefined` field entirely rather
    // than writing it, so a transient DexScreener miss on a token this function has already
    // touched before (e.g. a shared quote token like WETH, revisited when a new pool that
    // quotes in it gets tracked) can never clobber a real, previously-resolved logo with
    // null. `create` has no such history to protect, so a genuine miss there is honestly
    // null, same as every other unresolved field on this model.
    update: { symbol: metadata.symbol, name: metadata.name, decimals: metadata.decimals, logoUrl: logoUrl ?? undefined },
    create: {
      chainId,
      contractAddress,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals,
      logoUrl,
    },
  });
}
