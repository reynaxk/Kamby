import { EvmChainDataProvider, UniswapV3PoolReader, computePoolLiquidityUsd, priceFromSqrtPriceX96 } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createTrackedMarket } from './create-tracked-market';

/** Same conservative bound MarketIngestionService already proved safe for eth_getLogs on
 *  this chain's public RPC — see ingestion.ts's own MAX_BLOCKS_PER_TICK doc comment for the
 *  real incident (QuickNode's 5-block cap, ~6M credits burned) that constant exists to
 *  prevent a repeat of. Duplicated, not imported, since this is a genuinely separate ticker
 *  with its own cursor — see this file's own class doc comment for why. Verified directly
 *  2026-09-24 that the public Base RPC's real current eth_getLogs cap is 2,000 blocks (a
 *  factory-wide query, not per-pool), so 150 stays comfortable headroom under that too. */
const MAX_BLOCKS_PER_TICK = 150n;
/** A pool discovered this many milliseconds ago that still hasn't cleared the liquidity
 *  floor is given up on — keeps the pending set bounded rather than growing forever with
 *  pools that were never going anywhere. ~14 days: enough runway for a legitimate project to
 *  actually add real liquidity, not so long that dead pools linger indefinitely. */
const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
/** How many pending pools get a real liquidity re-check per tick — bounds this tick's RPC
 *  work independently of how many pools happen to be pending, same "bounded regardless of
 *  real activity" principle MAX_BLOCKS_PER_TICK already enforces for swap ingestion. */
const MAX_PENDING_CHECKS_PER_TICK = 10;
const RPC_CALL_DELAY_MS = 350;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface PendingPool {
  token0: string;
  token1: string;
  fee: number;
  /** Which side was already a known, price-resolvable token at discovery time — the other
   *  side is the unknown one createTrackedMarket will track as the base token once
   *  promoted. */
  knownSide: 'token0' | 'token1';
  firstSeenAtMs: number;
}

export interface PoolDiscoveryConfig {
  chainIdentifier: string;
  chainName: string;
  chainNativeSymbol: string;
  /** The Uniswap-V3-ABI-compatible factory contract to watch — a real, verified address,
   *  never assumed to be the same across chains (Base's is NOT Ethereum mainnet's — see
   *  this session's own commit history for the incident that caught this before it shipped). */
  factoryAddress: string;
  quoteUsdcAddress: string;
  dex: 'uniswap-v3' | 'pancakeswap-v3';
  /** Minimum real, on-chain-read USD liquidity a discovered pool must clear before being
   *  promoted into a real TokenMarket row — see this class's own doc comment for what this
   *  does and doesn't protect against. */
  liquidityFloorUsd: number;
}

export interface PoolDiscoveryResult {
  discovered: number;
  pendingChecked: number;
  promoted: number;
  expired: number;
}

/**
 * Automated discovery for pools this chain's curated seed list doesn't know about — the
 * "real terminal" answer to Kamby's Markets tab being bounded by hand-picked tokens (see
 * seed-markets.ts). Two-phase, both bounded and both resuming from a persisted Redis
 * cursor/set rather than Postgres — deliberately avoids a new migration for this first
 * version (see this session's own history: a migration that needed production access this
 * sandbox couldn't safely provide).
 *
 * Phase 1 (`discoverNewPools`): watches the Factory's `PoolCreated` events via the same
 * bounded eth_getLogs chunking discipline as swap ingestion. A discovered pool is tracked as
 * "pending" only if at least one of its two tokens is already a known, price-resolvable
 * token (the chain's own USDC peg, or a token already used as a base/quote in some existing
 * TokenMarket) — a pool where NEITHER side is known can never be honestly priced (nothing
 * to derive its liquidity in USD terms from), so it's skipped entirely rather than tracked
 * forever unpriceable.
 *
 * Phase 2 (`checkPendingPools`): re-checks a bounded number of pending pools' REAL on-chain
 * liquidity each tick (never trusted from the discovery event alone — a brand-new pool
 * almost always starts near-zero and only gains real liquidity over the following hours/
 * days, which is exactly why this needs to be a repeated check, not a one-time gate at
 * discovery). A pool that clears `liquidityFloorUsd` is promoted into a real TokenMarket row
 * via createTrackedMarket — from that point on it's indistinguishable from a seeded market,
 * picked up automatically by ingestSwaps() and the DB-driven refreshPricesAndLiquidity()
 * (see ingestion.ts).
 *
 * What this deliberately does NOT do: any spam/rug/honeypot detection beyond the liquidity
 * floor. A pool can clear real liquidity and still be a scam (fake volume, a sell-blocking
 * honeypot, a rug pulled the moment real liquidity looks enticing) — this is MVP-scope
 * filtering only, not represented as more than that anywhere it's surfaced. Newly-promoted
 * pools auto-publish immediately once they clear the floor; there is no manual review queue
 * in this version — a deliberate default given a real product decision either way, flagged
 * plainly rather than silently assumed to be the only option.
 */
export class PoolDiscoveryService {
  private readonly poolReader: UniswapV3PoolReader;
  private readonly tokenReader: EvmChainDataProvider;
  private readonly cursorKey: string;
  private readonly pendingKey: string;
  private chainId: number | null = null;

  constructor(
    private readonly config: PoolDiscoveryConfig,
    rpcUrl: string,
    private readonly logger: Logger,
    private readonly redis: Redis,
    rpcUrlFallback: string | null = null,
  ) {
    this.poolReader = new UniswapV3PoolReader({ rpcUrl, rpcUrlFallback });
    this.tokenReader = new EvmChainDataProvider({
      chain: { identifier: config.chainIdentifier, name: config.chainName, nativeSymbol: config.chainNativeSymbol },
      rpcUrl,
      rpcUrlFallback,
    });
    this.cursorKey = `pool-discovery:cursor:${config.chainIdentifier}`;
    this.pendingKey = `pool-discovery:pending:${config.chainIdentifier}`;
  }

  /** Resolves and caches this chain's internal Chain.id — same "seed() must run first"
   *  contract MarketIngestionService uses, but here resolved lazily on first real use since
   *  this service has no seed() of its own (it never creates the Chain row itself — that's
   *  MarketIngestionService's job, and both tickers run against the same chain). */
  private async requireChainId(): Promise<number> {
    if (this.chainId !== null) return this.chainId;
    const chain = await prisma.chain.upsert({
      where: { identifier: this.config.chainIdentifier },
      update: {},
      create: { identifier: this.config.chainIdentifier, name: this.config.chainName, nativeSymbol: this.config.chainNativeSymbol, rpcConfigKey: 'discovery' },
    });
    this.chainId = chain.id;
    return chain.id;
  }

  async discoverNewPools(): Promise<{ discovered: number }> {
    const chainId = await this.requireChainId();
    const latestBlock = await this.poolReader.getLatestBlockNumber();
    const storedCursor = await this.redis.get(this.cursorKey);
    // First run: start one chunk back, not from the factory's genesis — discovery is
    // forward-looking (see this class's own doc comment); it doesn't need to (and, bounded
    // to MAX_BLOCKS_PER_TICK per tick, realistically couldn't quickly) backfill years of
    // history.
    const cursorBlock = storedCursor ? BigInt(storedCursor) : latestBlock - MAX_BLOCKS_PER_TICK;
    if (latestBlock <= cursorBlock) return { discovered: 0 };

    const toBlock = latestBlock < cursorBlock + MAX_BLOCKS_PER_TICK ? latestBlock : cursorBlock + MAX_BLOCKS_PER_TICK;
    const events = await this.poolReader.getPoolCreatedEvents(this.config.factoryAddress, cursorBlock + 1n, toBlock);
    if (events === null) {
      this.logger.warn({ fromBlock: (cursorBlock + 1n).toString(), toBlock: toBlock.toString() }, 'Pool discovery: eth_getLogs failed — cursor left unadvanced, will retry this range next tick');
      return { discovered: 0 };
    }

    let discovered = 0;
    for (const event of events) {
      const known = await this.knownSideOf(chainId, event.token0, event.token1);
      if (known === null) continue; // neither side resolvable — never honestly priceable, skip entirely

      const already = await this.redis.hexists(this.pendingKey, event.pool.toLowerCase());
      if (already) continue;

      const pending: PendingPool = { token0: event.token0, token1: event.token1, fee: event.fee, knownSide: known, firstSeenAtMs: Date.now() };
      await this.redis.hset(this.pendingKey, event.pool.toLowerCase(), JSON.stringify(pending));
      discovered += 1;
    }

    await this.redis.set(this.cursorKey, toBlock.toString());
    if (discovered > 0) this.logger.info({ discovered, fromBlock: (cursorBlock + 1n).toString(), toBlock: toBlock.toString() }, 'Pool discovery: new candidate pools found');
    return { discovered };
  }

  /** A token counts as "known" if it's this chain's own pegged USDC (price = 1 by
   *  definition) or if it's already tracked as a base or quote token on some existing
   *  TokenMarket for this chain (price resolvable from that market's own current priceUsd —
   *  see resolveKnownTokenUsdPrice). Returns which side (token0/token1) was known, or null
   *  if neither is — mirrors the exact resolvability rule refreshPricesAndLiquidity already
   *  enforces for every other market, just checked earlier (before ever tracking a pool as
   *  pending) rather than only discovered when a price refresh later fails. */
  private async knownSideOf(chainId: number, token0: string, token1: string): Promise<'token0' | 'token1' | null> {
    if (token0.toLowerCase() === this.config.quoteUsdcAddress.toLowerCase()) return 'token0';
    if (token1.toLowerCase() === this.config.quoteUsdcAddress.toLowerCase()) return 'token1';
    if (await this.isTrackedToken(chainId, token0)) return 'token0';
    if (await this.isTrackedToken(chainId, token1)) return 'token1';
    return null;
  }

  private async isTrackedToken(chainId: number, tokenAddress: string): Promise<boolean> {
    const token = await prisma.token.findUnique({ where: { chainId_contractAddress: { chainId, contractAddress: tokenAddress } } });
    if (!token) return false;
    const asBase = await prisma.tokenMarket.findFirst({ where: { chainId, tokenId: token.id, priceUsd: { not: null } } });
    if (asBase) return true;
    const asQuote = await prisma.tokenMarket.findFirst({ where: { chainId, quoteTokenId: token.id } });
    return asQuote !== null;
  }

  private async resolveKnownTokenUsdPrice(chainId: number, tokenAddress: string): Promise<number | null> {
    if (tokenAddress.toLowerCase() === this.config.quoteUsdcAddress.toLowerCase()) return 1;
    const token = await prisma.token.findUnique({ where: { chainId_contractAddress: { chainId, contractAddress: tokenAddress } } });
    if (!token) return null;
    const market = await prisma.tokenMarket.findFirst({ where: { chainId, tokenId: token.id, priceUsd: { not: null } } });
    return market?.priceUsd ? Number(market.priceUsd) : null;
  }

  async checkPendingPools(): Promise<{ pendingChecked: number; promoted: number; expired: number }> {
    const chainId = await this.requireChainId();
    const allPending = await this.redis.hgetall(this.pendingKey);
    const poolAddresses = Object.keys(allPending).slice(0, MAX_PENDING_CHECKS_PER_TICK);

    let promoted = 0;
    let expired = 0;
    for (const poolAddress of poolAddresses) {
      const pending: PendingPool = JSON.parse(allPending[poolAddress]!);

      if (Date.now() - pending.firstSeenAtMs > PENDING_MAX_AGE_MS) {
        await this.redis.hdel(this.pendingKey, poolAddress);
        expired += 1;
        this.logger.info({ pool: poolAddress, ageDays: Math.round((Date.now() - pending.firstSeenAtMs) / 86_400_000) }, 'Pool discovery: giving up on a candidate that never cleared the liquidity floor');
        continue;
      }

      try {
        const promotedNow = await this.checkOnePendingPool(chainId, poolAddress, pending);
        if (promotedNow) {
          await this.redis.hdel(this.pendingKey, poolAddress);
          promoted += 1;
        }
      } catch (error) {
        // One pool's check failing (an unexpected RPC/decoding error, not the ordinary
        // "not ready yet" `false` return) must not stop the rest of this tick's pending
        // pools from being checked — same "one bad item never kills the tick" contract
        // every other ticker in this codebase follows. Left in the pending set, retried
        // next tick.
        this.logger.error({ err: error, pool: poolAddress }, 'Pool discovery: pending-pool check threw — will retry next tick');
      }
      await sleep(RPC_CALL_DELAY_MS);
    }

    if (promoted > 0 || expired > 0) {
      this.logger.info({ pendingChecked: poolAddresses.length, promoted, expired }, 'Pool discovery: pending-pool check complete');
    }
    return { pendingChecked: poolAddresses.length, promoted, expired };
  }

  private async checkOnePendingPool(chainId: number, poolAddress: string, pending: PendingPool): Promise<boolean> {
    const knownAddress = pending.knownSide === 'token0' ? pending.token0 : pending.token1;
    const unknownAddress = pending.knownSide === 'token0' ? pending.token1 : pending.token0;

    const knownUsd = await this.resolveKnownTokenUsdPrice(chainId, knownAddress);
    if (knownUsd === null) return false; // the known side's own market lost its price this tick — try again next time

    const poolState = await this.poolReader.getPoolState(poolAddress);
    if (!poolState) return false;

    const dec = await this.tokenReader.getTokenMetadata(unknownAddress);
    const knownDec = await this.tokenReader.getTokenMetadata(knownAddress);
    if (dec.decimals === null || knownDec.decimals === null) return false;

    const [dec0, dec1] = pending.knownSide === 'token0' ? [knownDec.decimals, dec.decimals] : [dec.decimals, knownDec.decimals];
    const priceToken1PerToken0 = priceFromSqrtPriceX96(poolState.sqrtPriceX96, dec0, dec1);
    if (priceToken1PerToken0 === null) return false;

    const [price0Usd, price1Usd] =
      pending.knownSide === 'token0'
        ? [knownUsd, priceToken1PerToken0 > 0 ? knownUsd / priceToken1PerToken0 : null]
        : [priceToken1PerToken0 * knownUsd, knownUsd];

    const [balance0, balance1] = await Promise.all([
      this.poolReader.getTokenBalance(poolState.token0, poolAddress),
      this.poolReader.getTokenBalance(poolState.token1, poolAddress),
    ]);
    if (balance0 === null || balance1 === null) return false;

    const liquidityUsd = computePoolLiquidityUsd(balance0, dec0, price0Usd, balance1, dec1, price1Usd);
    if (liquidityUsd === null || liquidityUsd < this.config.liquidityFloorUsd) return false;

    const ok = await createTrackedMarket(this.poolReader, this.tokenReader, chainId, poolAddress, unknownAddress, this.config.dex, this.logger);
    if (ok) {
      this.logger.info({ pool: poolAddress, baseToken: unknownAddress, liquidityUsd: Math.round(liquidityUsd) }, 'Pool discovery: promoted a new market — real liquidity cleared the floor');
    }
    return ok;
  }
}
