import { EvmChainDataProvider, UniswapV3PoolReader } from '@kamby/chain-adapters';
import {
  computeFullyDilutedMarketCapUsd,
  computePoolLiquidityUsd,
  priceFromSqrtPriceX96,
  rawAmountToDecimal,
} from '@kamby/chain-adapters';
import type { Prisma } from '@kamby/db';
import { prisma } from '@kamby/db';
import { ACTIVITY_REALTIME_CHANNEL, DISCOVERY_RANKING, normalizeEvmAddress, type SeedMarket } from '@kamby/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  NotificationFanoutService,
  type InsertedSwap,
} from '../notifications/notification-fanout.service';
import { createTrackedMarket, fetchTokenLogoUrl } from './create-tracked-market';

/** Raw candle granularity — see the Candle model comment in schema.prisma. */
const BUCKET_MINUTES = 5;
/** Upper bound on how far one tick advances a market's cursor — keeps a single tick's swap
 *  scan bounded (a large backfill gap simply continues over several ticks rather than one
 *  tick pulling an unbounded number of events) and each getLogs response a predictable size.
 *  LOG_CHUNK_BLOCKS below is deliberately tied to this value, not an independent constant —
 *  see its own comment for why. */
const MAX_BLOCKS_PER_TICK = 2000n;
/** A market further behind the chain head than this skips ahead instead of crawling — BNB
 *  (0.75s blocks) fell days behind at 150 blocks/tick and showed $0 24h volume on every major
 *  pair (2026-10-01). The skipped range is logged; 24h volume rebuilds from the jump on. */
const MAX_LAG_BLOCKS = 20_000n;
/** eth_getLogs range per request — deliberately equal to MAX_BLOCKS_PER_TICK, so the
 *  chunking loop in ingestSwapsForMarket always resolves in exactly one iteration per
 *  market per tick: chunkEnd = min(target, cursor + LOG_CHUNK_BLOCKS) can never need a
 *  second pass when LOG_CHUNK_BLOCKS already covers everything a tick could ask for.
 *
 *  This used to be hard-pinned at 5n because QuickNode's free "Discover" plan capped
 *  eth_getLogs at a 5-block range per call (confirmed directly via QuickNode's own error:
 *  "eth_getLogs is limited to a 5 range, upgrade from discover plan..."). That turned what
 *  should have been 1 getLogs call per market per tick into up to 30 (150 / 5) — the single
 *  biggest driver behind burning ~6M QuickNode credits in the platform's first 5 days,
 *  entirely from 24/7 background polling, independent of any real trading volume. Upgraded
 *  off that plan 2026-09-15. If the new plan's real per-call block-range cap ever turns out
 *  to be lower than MAX_BLOCKS_PER_TICK, pin this back down explicitly the same way it was
 *  before — don't assume "paid" automatically means "uncapped." */
const LOG_CHUNK_BLOCKS = MAX_BLOCKS_PER_TICK;
/** Space out RPC calls so the free endpoint doesn't rate-limit us mid-tick. */
const RPC_CALL_DELAY_MS = 350;
/** Bounds refreshPricesAndLiquidity's quote-token-dependency resolution passes — see that
 *  method's own doc comment. A real dependency chain (base quoted in an intermediate token
 *  quoted in USDC) is at most 2-3 levels deep; this is deliberately generous headroom
 *  above that, not a value tuned to any specific seed list. */
const MAX_RESOLUTION_PASSES = 5;

/** Blocks market data stays behind the chain head — market data reads go through a list of
 *  free public endpoints (see PUBLIC_EVM_RPC_URLS), and this is what keeps a node that's a
 *  few blocks behind from silently losing swaps; see UniswapV3PoolReader#getLatestBlockNumber.
 *  ~20s on Base, ~8s on BNB Chain. */
export const MARKET_HEAD_LAG_BLOCKS = 10;

/** Beyond these, a USD figure is a pricing artifact (a near-empty pool pushed to its extreme
 *  tick), not a real trade — and past ~1e20 it overflows the Decimal(38, 18) columns
 *  outright. Found 2026-09-30: one such swap on BNB threw from `swap.createMany`, which
 *  aborted that whole ingestion tick for every market after it. */
export const MAX_PLAUSIBLE_PRICE_USD = 1e15;
export const MAX_PLAUSIBLE_SWAP_VOLUME_USD = 1e11;

function isPlausibleUsd(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < max;
}

/** How often a dormant market (see `isDormant`) is still refreshed — every Nth tick. */
export const DORMANT_REFRESH_EVERY_N_TICKS = 10;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MarketIngestionConfig {
  chainIdentifier: string;
  chainName: string;
  chainNativeSymbol: string;
  rpcConfigKey: string;
  /** This deployment's own curated pool list — see SEED_MARKETS_BY_CHAIN_IDENTIFIER in
   *  packages/domain/src/seed-markets.ts, resolved once in main.ts from env.CHAIN_IDENTIFIER. Threaded through
   *  config (2026-09-16, BNB Chain going live) instead of importing BASE_SEED_MARKETS
   *  directly, since apps/workers runs one chain per deployed instance and this class
   *  needed to stop assuming that chain was always Base. */
  seedMarkets: SeedMarket[];
  /** This deployment's own pegged-to-$1 reference token — see resolveUsdPrice's seeding
   *  below and SEED_MARKETS_BY_CHAIN_IDENTIFIER's matching quoteUsdcAddress. */
  quoteUsdcAddress: string;
}

/**
 * Owns the full Phase 1 pipeline for one chain: seed → price/liquidity snapshot →
 * incremental swap backfill → candle/rollup recomputation. Every write is idempotent
 * (upserts keyed exactly as documented in docs/SOURCE_OF_TRUTH.md), so a crash mid-tick
 * just means the next tick redoes a little work, never corrupts state.
 */
export class MarketIngestionService {
  private readonly poolReader: UniswapV3PoolReader;
  private readonly tokenReader: EvmChainDataProvider;
  private readonly fanout: NotificationFanoutService;
  private chainId: number | null = null;

  constructor(
    private readonly config: MarketIngestionConfig,
    rpcUrl: string | readonly string[],
    private readonly logger: Logger,
    private readonly redis: Redis,
    whaleTradeUsdThreshold: number,
    rpcUrlFallback: string | null = null,
  ) {
    this.poolReader = new UniswapV3PoolReader({ rpcUrl, rpcUrlFallback, headLagBlocks: MARKET_HEAD_LAG_BLOCKS });
    this.tokenReader = new EvmChainDataProvider({
      chain: {
        identifier: config.chainIdentifier,
        name: config.chainName,
        nativeSymbol: config.chainNativeSymbol,
      },
      rpcUrl,
      rpcUrlFallback,
    });
    this.fanout = new NotificationFanoutService(redis, logger, whaleTradeUsdThreshold);
    this.seedTokenAddresses = new Set(config.seedMarkets.map((m) => m.baseTokenAddress.toLowerCase()));
    this.seedPoolByToken = new Map(config.seedMarkets.map((m) => [m.baseTokenAddress.toLowerCase(), m.poolAddress.toLowerCase()]));
  }

  private readonly seedPoolByToken: ReadonlyMap<string, string>;

  /**
   * A second market for a seed-list token (not its seed pool) — found 2026-09-30: a
   * discovered WBNB/BNCB pool. Refreshing it would recompute WBNB's USD price through BNCB
   * (itself priced from WBNB) and could overwrite the real one for every WBNB-quoted market
   * in the same tick, so it's never refreshed or ingested; the API also never lists or
   * trades it (see findPrimaryMarket in apps/api).
   */
  private isShadowOfSeed(market: { pairAddress: string; token: { contractAddress: string } }): boolean {
    const seedPool = this.seedPoolByToken.get(market.token.contractAddress.toLowerCase());
    return seedPool !== undefined && seedPool !== market.pairAddress.toLowerCase();
  }

  private readonly seedTokenAddresses: ReadonlySet<string>;
  /** Counts refreshPricesAndLiquidity() calls — one per worker tick (see main.ts). */
  private tickCount = 0;
  private logoBackfillCalls = 0;

  /**
   * A discovered (non-seed) market whose last measured liquidity is below Discover's own
   * minimum — nothing anyone can see or sensibly trade. Found 2026-09-30: once liquidity was
   * measured honestly (see computePoolLiquidityUsd's `anchor`), ~65 of Base's ~85 markets
   * were copycat pools holding a few dollars, yet each still cost a full set of RPC calls
   * every tick, stretching one Base tick to ~6 minutes — long enough that swap cursors
   * (150 blocks per tick) fell further behind Base's ~180 blocks every tick. They're still
   * refreshed every DORMANT_REFRESH_EVERY_N_TICKS-th tick, so one that gains real
   * liquidity comes back on its own. Unknown liquidity (null) is never dormant.
   */
  private isDormant(market: { liquidityUsd: Prisma.Decimal | null; token: { contractAddress: string } }): boolean {
    if (this.seedTokenAddresses.has(market.token.contractAddress.toLowerCase())) return false;
    return market.liquidityUsd !== null && Number(market.liquidityUsd) < DISCOVERY_RANKING.minLiquidityUsd;
  }

  /** True on the ticks where dormant markets are processed too. */
  private isFullTick(): boolean {
    return this.tickCount % DORMANT_REFRESH_EVERY_N_TICKS === 1;
  }

  /** Idempotent — upserts the chain, tokens, and markets. Safe to call every tick. */
  async seed(): Promise<void> {
    const chain = await prisma.chain.upsert({
      where: { identifier: this.config.chainIdentifier },
      update: {},
      create: {
        identifier: this.config.chainIdentifier,
        name: this.config.chainName,
        nativeSymbol: this.config.chainNativeSymbol,
        rpcConfigKey: this.config.rpcConfigKey,
      },
    });
    this.chainId = chain.id;

    let seeded = 0;
    for (const seedMarket of this.config.seedMarkets) {
      if (await this.isFullySeeded(chain.id, seedMarket.poolAddress)) {
        seeded += 1;
        continue; // nothing read from the RPC — no need to pace against it either
      }
      const ok = await this.seedOneMarket(chain.id, seedMarket);
      if (ok) seeded += 1;
      await sleep(RPC_CALL_DELAY_MS);
    }
    this.logger.info({ attempted: this.config.seedMarkets.length, seeded }, 'Market seeding complete');
  }

  /**
   * Fills in `Token.logoUrl` for any already-tracked token that doesn't have one yet — see
   * `fetchTokenLogoUrl`'s own doc comment (create-tracked-market.ts) for why this needs a
   * separate backfill at all: a token seeded before this feature existed (every market
   * tracked before 2026-09-26) got its logo left null forever, since `seed()` skips a
   * market entirely once `isFullySeeded` is true, and adding the logo requirement *into*
   * `isFullySeeded` would force a full RPC re-read of pool state and both tokens' on-chain
   * metadata just to fetch an image — real, needless RPC cost across every existing market
   * simultaneously on the first tick after deploy. This pass is deliberately RPC-free: a
   * plain DB query plus a DexScreener HTTP call per still-missing token, nothing more.
   */
  async backfillTokenLogos(): Promise<{ checked: number; updated: number }> {
    // Runs every DORMANT_REFRESH_EVERY_N_TICKS-th call, not every tick: each still-missing
    // token costs up to two HTTP lookups plus RPC_CALL_DELAY_MS, and with dozens of logo-less
    // discovered tokens that alone added tens of seconds to every Base tick. A logo doesn't
    // need retrying every minute.
    if (this.logoBackfillCalls++ % DORMANT_REFRESH_EVERY_N_TICKS !== 0) return { checked: 0, updated: 0 };
    const chainId = this.requireChainId();
    const missing = await prisma.token.findMany({ where: { chainId, logoUrl: null } });

    let updated = 0;
    for (const token of missing) {
      const logoUrl = await fetchTokenLogoUrl(this.evmChainId(), token.contractAddress);
      if (logoUrl) {
        await prisma.token.update({ where: { id: token.id }, data: { logoUrl } });
        updated += 1;
      }
      await sleep(RPC_CALL_DELAY_MS);
    }
    if (missing.length > 0) this.logger.info({ checked: missing.length, updated }, 'Token logo backfill complete');
    return { checked: missing.length, updated };
  }

  /**
   * A market whose tokens are both fully resolved and whose cursor already exists needs
   * nothing further from `seed()` — a Uniswap V3 pool's fee tier is fixed at creation, so
   * there's nothing left to re-read. Checked by `seed()`'s loop before it calls
   * `seedOneMarket` at all, so a fully-resolved market makes no RPC calls and isn't paced
   * with `RPC_CALL_DELAY_MS` either: re-reading pool state and both tokens' metadata every
   * tick regardless of whether anything could have changed was pure waste on a
   * rate-limited free RPC, competing for the same budget the markets that are still
   * genuinely unresolved need.
   */
  private async isFullySeeded(chainId: number, poolAddress: string): Promise<boolean> {
    const existing = await prisma.tokenMarket.findUnique({
      where: { chainId_pairAddress: { chainId, pairAddress: poolAddress } },
      include: { token: true, quoteToken: true, cursor: true },
    });
    return (
      existing !== null &&
      existing.cursor !== null &&
      existing.token.decimals !== null &&
      existing.token.symbol !== null &&
      existing.quoteToken.decimals !== null &&
      existing.quoteToken.symbol !== null
    );
  }

  private async seedOneMarket(chainId: number, seed: SeedMarket): Promise<boolean> {
    return createTrackedMarket(
      this.poolReader,
      this.tokenReader,
      chainId,
      this.evmChainId(),
      seed.poolAddress,
      seed.baseTokenAddress,
      seed.dex,
      this.logger,
    );
  }

  /** The real numeric EVM chain id (e.g. 8453 for Base) parsed from `chainIdentifier`
   *  (`"eip155:8453"`) — same derivation main.ts's own `tradeChainId` already uses.
   *  Distinct from `Chain.id` (the internal DB row id `requireChainId()` returns) — see
   *  `createTrackedMarket`'s own doc comment for the real bug conflating the two caused. */
  private evmChainId(): number {
    return Number(this.config.chainIdentifier.split(':')[1]);
  }

  /**
   * Refreshes current price/liquidity/market cap for every market tracked in the DB for
   * this chain — deliberately DB-driven, not looped over `this.config.seedMarkets`, so a
   * market added outside the static seed list (e.g. PoolDiscoveryService promoting a
   * newly-discovered pool — see pool-discovery.ts) gets the exact same ongoing refresh a
   * seeded market does, rather than being priced once at creation and then going stale
   * forever (computeDiscoveryScore excludes anything whose lastPriceUpdateAt falls outside
   * the staleness window).
   *
   * A market quoted in another tracked token (e.g. DEGEN/WETH) needs its quote token's own
   * USD price resolved first. The static seed list used to guarantee this by manual
   * ordering; now that markets come from the DB in no particular order, this instead makes
   * repeated passes over whatever's still unresolved until a pass makes no further
   * progress — bounded to MAX_RESOLUTION_PASSES, since a real dependency chain here is at
   * most 2-3 levels deep (a token quoted in a token quoted in USDC).
   */
  async refreshPricesAndLiquidity(): Promise<void> {
    this.tickCount += 1;
    const allMarkets = await prisma.tokenMarket.findMany({
      where: { chainId: this.requireChainId() },
      include: { token: true, quoteToken: true },
    });
    const live = allMarkets.filter((m) => !this.isShadowOfSeed(m));
    const markets = this.isFullTick() ? live : live.filter((m) => !this.isDormant(m));
    const resolvedUsdPrices = new Map<string, number>([[this.config.quoteUsdcAddress.toLowerCase(), 1]]);

    let updated = 0;
    let skipped = 0;
    let remaining = markets;
    for (let pass = 0; pass < MAX_RESOLUTION_PASSES && remaining.length > 0; pass++) {
      const stillUnresolved: typeof remaining = [];
      for (const market of remaining) {
        const quoteUsd = resolvedUsdPrices.get(market.quoteToken.contractAddress.toLowerCase());
        if (quoteUsd === undefined) {
          // Quote token not resolved yet — may resolve in a later pass once its own market
          // (elsewhere in `remaining`) has been processed. Not counted as skipped until the
          // final pass genuinely can't place it.
          stillUnresolved.push(market);
          continue;
        }
        let ok = false;
        try {
          ok = await this.refreshOneMarket(market, resolvedUsdPrices);
        } catch (error) {
          this.logger.error({ err: error, pool: market.pairAddress }, 'Price refresh failed for one market — continuing with the rest');
        }
        if (ok) updated += 1;
        else skipped += 1;
        await sleep(RPC_CALL_DELAY_MS);
      }
      if (stillUnresolved.length === remaining.length) break; // no progress this pass — stop early
      remaining = stillUnresolved;
    }
    skipped += remaining.length; // never resolved after MAX_RESOLUTION_PASSES — a genuinely broken quote chain, not fabricated
    for (const market of remaining) {
      this.logger.warn(
        { pool: market.pairAddress, quote: market.quoteToken.symbol },
        'Skipped price refresh: quote token has no resolved USD price after every resolution pass',
      );
    }
    this.logger.info({ updated, skipped }, 'Price/liquidity refresh complete');
  }

  private async refreshOneMarket(
    market: Prisma.TokenMarketGetPayload<{ include: { token: true; quoteToken: true } }>,
    resolvedUsdPrices: Map<string, number>,
  ): Promise<boolean> {
    if (market.token.decimals === null || market.quoteToken.decimals === null) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: decimals unknown');
      return false;
    }

    const poolState = await this.poolReader.getPoolState(market.pairAddress);
    if (!poolState) {
      this.logger.warn(
        { pool: market.pairAddress },
        'Skipped price refresh: pool state unreadable',
      );
      return false;
    }
    await sleep(RPC_CALL_DELAY_MS);

    const baseIsToken0 =
      poolState.token0.toLowerCase() === market.token.contractAddress.toLowerCase();
    const [dec0, dec1] = baseIsToken0
      ? [market.token.decimals, market.quoteToken.decimals]
      : [market.quoteToken.decimals, market.token.decimals];
    const priceQuotePerBase = priceFromSqrtPriceX96(poolState.sqrtPriceX96, dec0, dec1);
    if (priceQuotePerBase === null) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: pool uninitialized');
      return false;
    }
    // priceQuotePerBase is (token1 per token0); flip if base is token1.
    const quotePerBase = baseIsToken0 ? priceQuotePerBase : 1 / priceQuotePerBase;

    const quoteUsd = resolvedUsdPrices.get(market.quoteToken.contractAddress.toLowerCase());
    if (quoteUsd === undefined) {
      this.logger.warn(
        { pool: market.pairAddress, quote: market.quoteToken.symbol },
        'Skipped price refresh: quote token has no resolved USD price yet (seed list ordering)',
      );
      return false;
    }
    const baseUsd = quotePerBase * quoteUsd;
    if (!isPlausibleUsd(baseUsd, MAX_PLAUSIBLE_PRICE_USD)) {
      this.logger.warn({ pool: market.pairAddress }, 'Skipped price refresh: implausible USD price (a near-empty pool at an extreme tick)');
      return false;
    }
    resolvedUsdPrices.set(market.token.contractAddress.toLowerCase(), baseUsd);

    const [balance0, balance1] = await Promise.all([
      this.poolReader.getTokenBalance(poolState.token0, market.pairAddress),
      this.poolReader.getTokenBalance(poolState.token1, market.pairAddress),
    ]);
    await sleep(RPC_CALL_DELAY_MS);
    const price0Usd = baseIsToken0 ? baseUsd : quoteUsd;
    const price1Usd = baseIsToken0 ? quoteUsd : baseUsd;
    const liquidityUsd =
      balance0 !== null && balance1 !== null
        ? computePoolLiquidityUsd(balance0, dec0, price0Usd, balance1, dec1, price1Usd, baseIsToken0 ? 'token1' : 'token0')
        : null;

    const totalSupply = await this.poolReader.getTotalSupply(market.token.contractAddress);
    const marketCapUsd =
      totalSupply !== null
        ? computeFullyDilutedMarketCapUsd(totalSupply, market.token.decimals, baseUsd)
        : null;

    await prisma.tokenMarket.update({
      where: { id: market.id },
      data: {
        priceUsd: baseUsd,
        liquidityUsd: liquidityUsd ?? undefined,
        marketCapUsd: marketCapUsd ?? undefined,
        lastPriceUpdateAt: new Date(),
      },
    });
    return true;
  }

  /** Incrementally scans new Swap events for every market, from its persisted cursor. */
  async ingestSwaps(): Promise<void> {
    const markets = await prisma.tokenMarket.findMany({
      where: { chainId: this.requireChainId() },
      include: { token: true, quoteToken: true, cursor: true },
    });

    // Current USD price per quote token, resolved once for this tick from whatever
    // refreshPricesAndLiquidity() last persisted (it runs first in the worker's tick —
    // see main.ts). Used to convert quote-denominated swap volume into USD — see the
    // "Swap volume in USD" note in docs/MARKET_DATA.md for the limitation this implies
    // for non-USD-quoted markets (their historical swaps are priced at today's quote rate,
    // not the rate at the time of that trade).
    const quoteUsdPrices = new Map<string, number>([[this.config.quoteUsdcAddress.toLowerCase(), 1]]);
    for (const m of markets) {
      if (m.priceUsd !== null)
        quoteUsdPrices.set(m.token.contractAddress.toLowerCase(), Number(m.priceUsd));
    }

    const fullTick = this.isFullTick();
    for (const market of markets) {
      if (!market.cursor) continue;
      if (this.isShadowOfSeed(market)) continue;
      if (!fullTick && this.isDormant(market)) continue;
      const quoteUsd = quoteUsdPrices.get(market.quoteToken.contractAddress.toLowerCase());
      if (quoteUsd === undefined) {
        this.logger.warn(
          { pool: market.pairAddress },
          'Skipped swap ingestion: quote token has no resolved USD price',
        );
        continue;
      }
      // One market's failure (bad data, a DB error) is logged and its cursor left where it
      // was — never allowed to abort the tick for every market after it.
      try {
        await this.ingestSwapsForMarket(market, quoteUsd);
      } catch (error) {
        this.logger.error({ err: error, pool: market.pairAddress }, 'Swap ingestion failed for one market — cursor left unadvanced, continuing with the rest');
      }
      await sleep(RPC_CALL_DELAY_MS);
    }
  }

  private async ingestSwapsForMarket(
    market: Prisma.TokenMarketGetPayload<{
      include: { token: true; quoteToken: true; cursor: true };
    }>,
    quoteUsdPrice: number,
  ): Promise<void> {
    if (market.token.decimals === null || market.quoteToken.decimals === null) return;
    const poolState = await this.poolReader.getPoolState(market.pairAddress);
    if (!poolState) return;
    const baseIsToken0 =
      poolState.token0.toLowerCase() === market.token.contractAddress.toLowerCase();
    const [poolDec0, poolDec1] = baseIsToken0
      ? [market.token.decimals, market.quoteToken.decimals]
      : [market.quoteToken.decimals, market.token.decimals];

    const latestBlock = await this.poolReader.getLatestBlockNumber();
    let cursorBlock = market.cursor!.lastProcessedBlock;
    if (latestBlock - cursorBlock > MAX_LAG_BLOCKS) {
      const resumeFrom = latestBlock - MAX_BLOCKS_PER_TICK;
      this.logger.warn(
        { pool: market.pairAddress, symbol: market.token.symbol, fromBlock: cursorBlock.toString(), toBlock: resumeFrom.toString() },
        'Swap ingestion too far behind the chain head — skipping ahead; swaps in this range are not indexed',
      );
      cursorBlock = resumeFrom;
    }

    if (latestBlock > cursorBlock) {
      const targetBlock = bigintMin(latestBlock, cursorBlock + MAX_BLOCKS_PER_TICK);
      const blockTimestampCache = new Map<string, Date>();
      let cursor = cursorBlock;
      let totalSwaps = 0;
      let minTs: Date | null = null;
      let maxTs: Date | null = null;

      while (cursor < targetBlock) {
        const chunkEnd = bigintMin(targetBlock, cursor + LOG_CHUNK_BLOCKS);
        const events = await this.poolReader.getSwapEvents(
          market.pairAddress,
          cursor + 1n,
          chunkEnd,
        );
        if (events === null) {
          // eth_getLogs itself failed for this range — distinct from a successful query
          // that just found nothing. Stop here without touching the cursor, so the next
          // tick retries this exact range instead of silently skipping it forever.
          this.logger.warn(
            {
              pool: market.pairAddress,
              fromBlock: (cursor + 1n).toString(),
              toBlock: chunkEnd.toString(),
            },
            'Stopped swap ingestion: eth_getLogs failed — cursor left unadvanced, will retry this range next tick',
          );
          break;
        }

        const rows: Prisma.SwapCreateManyInput[] = [];
        // Trader wallets that must exist before `rows` can be inserted — `Swap.traderAddress`
        // is a foreign key to `wallets.address`. Keyed by address so a wallet appearing in
        // several events this chunk is only upserted once, with the earliest block
        // timestamp seen — a genuine "first observed trading," never today's date, and
        // never overwritten for a wallet we've already seen in an earlier tick (see the
        // skipDuplicates upsert below).
        const walletFirstSeen = new Map<string, Date>();
        let implausibleSkipped = 0;
        // Two timestamp lookups per chunk instead of one (plus a 350ms pause) per block:
        // Base and BNB produce blocks at a fixed interval, so a block's time interpolated
        // between the chunk's first and last block is accurate to about a second — far finer
        // than the 5-minute candles. Falls back to per-block lookups if an anchor fails.
        const anchors =
          events.length > 0
            ? await Promise.all([this.poolReader.getBlockTimestamp(cursor + 1n), this.poolReader.getBlockTimestamp(chunkEnd)])
            : [null, null];
        const interpolate = (blockNumber: bigint): Date | null => {
          const [start, end] = anchors;
          if (!start || !end) return null;
          const span = Number(chunkEnd - (cursor + 1n));
          if (span <= 0) return start;
          const offset = Number(blockNumber - (cursor + 1n));
          return new Date(start.getTime() + ((end.getTime() - start.getTime()) * offset) / span);
        };
        for (const event of events) {
          const key = event.blockNumber.toString();
          let blockTimestamp = blockTimestampCache.get(key) ?? interpolate(event.blockNumber) ?? undefined;
          if (!blockTimestamp) {
            const ts = await this.poolReader.getBlockTimestamp(event.blockNumber);
            if (!ts) continue; // can't honestly place this swap in time — skip it, don't guess
            blockTimestamp = ts;
            blockTimestampCache.set(key, blockTimestamp);
            await sleep(RPC_CALL_DELAY_MS);
          }

          // priceFromSqrtPriceX96 always returns token1-per-token0; invert if base is token1
          // so `priceInQuote` ends up as this market's base-token price in terms of its
          // quote token, then convert to USD using this tick's resolved quote price.
          const rawPrice = priceFromSqrtPriceX96(event.sqrtPriceX96, poolDec0, poolDec1);
          const priceInQuote = rawPrice === null ? null : baseIsToken0 ? rawPrice : 1 / rawPrice;
          const baseAmountRaw = baseIsToken0 ? event.amount0 : event.amount1;
          const baseAmount = rawAmountToDecimal(baseAmountRaw, market.token.decimals);
          if (priceInQuote === null) continue;

          const priceUsd = priceInQuote * quoteUsdPrice;
          const volumeUsd = Math.abs(baseAmount) * priceUsd;
          if (!isPlausibleUsd(priceUsd, MAX_PLAUSIBLE_PRICE_USD) || !isPlausibleUsd(volumeUsd, MAX_PLAUSIBLE_SWAP_VOLUME_USD)) {
            implausibleSkipped += 1;
            continue; // an artifact, not a trade — see MAX_PLAUSIBLE_PRICE_USD
          }
          // See the traderAddress/senderAddress comments on the Swap model in
          // schema.prisma — recipient is the trader-identity heuristic, sender is kept for
          // audit only. Null (not fabricated) when the log's indexed topic failed to decode.
          const traderAddress = event.recipient ? normalizeEvmAddress(event.recipient) : null;
          const senderAddress = event.sender ? normalizeEvmAddress(event.sender) : null;

          if (traderAddress) {
            const existing = walletFirstSeen.get(traderAddress);
            if (!existing || blockTimestamp < existing)
              walletFirstSeen.set(traderAddress, blockTimestamp);
          }

          rows.push({
            chainId: market.chainId,
            tokenMarketId: market.id,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: event.blockNumber,
            blockTimestamp,
            amount0Raw: event.amount0.toString(),
            amount1Raw: event.amount1.toString(),
            priceUsd,
            volumeUsd,
            side: baseAmount > 0 ? 'sell' : 'buy', // pool received base token => someone sold it
            traderAddress,
            senderAddress,
          });

          if (!minTs || blockTimestamp < minTs) minTs = blockTimestamp;
          if (!maxTs || blockTimestamp > maxTs) maxTs = blockTimestamp;
        }

        if (implausibleSkipped > 0) {
          this.logger.warn({ pool: market.pairAddress, skipped: implausibleSkipped }, 'Skipped swaps with implausible USD values (pricing artifacts, not trades)');
        }

        // Persist first, advance the cursor only once that succeeds — a thrown error here
        // propagates out and leaves the cursor exactly where it was, so a persistence
        // failure is retried next tick rather than skipped.
        if (rows.length > 0) {
          if (walletFirstSeen.size > 0) {
            await prisma.wallet.createMany({
              data: Array.from(walletFirstSeen, ([address, firstSeenAt]) => ({
                address,
                firstSeenAt,
              })),
              skipDuplicates: true,
            });
          }
          await prisma.swap.createMany({ data: rows, skipDuplicates: true });
          totalSwaps += rows.length;
          await this.publishNewActivity(market.id, rows.length);
          await this.notifyOnInsertedSwaps(rows);
        }

        cursor = chunkEnd;
        await prisma.ingestionCursor.update({
          where: { tokenMarketId: market.id },
          data: { lastProcessedBlock: cursor },
        });
        await sleep(RPC_CALL_DELAY_MS);
      }

      if (totalSwaps > 0) {
        this.logger.info(
          {
            pool: market.pairAddress,
            symbol: market.token.symbol,
            swaps: totalSwaps,
            fromBlock: cursorBlock.toString(),
            toBlock: targetBlock.toString(),
          },
          'Ingested swaps',
        );
        await this.upsertCandlesFromSwaps(market.id, minTs!, maxTs!);
      }
    }

    // Recomputed every tick — including one with zero new swaps — so volume24hUsd and
    // priceChange24hPct decay correctly as old activity ages out of the 24h window rather
    // than holding a stale high-water mark forever. See recomputeRollups.
    await this.recomputeRollups(market.id);

    // Trending depends only on this market's own now-fresh rollup, so it's checked
    // immediately after — see NotificationFanoutService#checkTrendingTransition.
    try {
      await this.fanout.checkTrendingTransition(market.id);
    } catch (error) {
      this.logger.error(
        { err: error, tokenMarketId: market.id },
        'Trending-transition notification check failed — indexing is unaffected',
      );
    }
  }

  /**
   * FOLLOWED_TRADER_TRADE/WHALE_TRADE/WATCHED_TOKEN_ACTIVITY notifications, fired from the
   * swaps this tick just persisted — see docs/NOTIFICATIONS.md and
   * docs/PHASE6_RETENTION_SOCIAL.md#notification-integration. `createMany` above doesn't
   * return inserted ids (same limitation noted throughout this file for wallets), so they're
   * recovered here via the natural `(chain_id, tx_hash, log_index)` unique key before
   * fan-out can reference them. Never allowed to fail the tick — a notification bug must not
   * break indexing.
   */
  private async notifyOnInsertedSwaps(rows: Prisma.SwapCreateManyInput[]): Promise<void> {
    try {
      const inserted = await prisma.swap.findMany({
        where: {
          OR: rows.map((r) => ({ chainId: r.chainId, txHash: r.txHash, logIndex: r.logIndex })),
        },
        select: { id: true, txHash: true, logIndex: true },
      });
      const idByKey = new Map(inserted.map((s) => [`${s.txHash}:${s.logIndex}`, s.id]));
      const insertedSwaps: InsertedSwap[] = rows.flatMap((r) => {
        const id = idByKey.get(`${r.txHash}:${r.logIndex}`);
        if (!id) return [];
        return [
          {
            id,
            tokenMarketId: r.tokenMarketId,
            traderAddress: r.traderAddress ?? null,
            amountUsd: Number(r.volumeUsd),
          },
        ];
      });

      await this.fanout.notifyFollowedTraderTrades(insertedSwaps);
      await this.fanout.notifyWhaleTrades(insertedSwaps);
      await this.fanout.notifyWatchedTokenActivity(insertedSwaps);
    } catch (error) {
      this.logger.error(
        { err: error },
        'Swap-triggered notification fan-out failed — indexing is unaffected',
      );
    }
  }

  /**
   * Tells the API's realtime layer that new activity landed, so a connected feed can
   * refetch instead of waiting for its next poll — see docs/SOCIAL.md#realtime. Deliberately
   * a bare ping (market id + count), not the activity payload itself: the worker doesn't
   * know or need to know the API's response shape, and a client that misses the message
   * just catches up on its next scheduled refetch. Never allowed to fail the tick — a
   * down Redis means slower-feeling activity, not broken ingestion.
   */
  private async publishNewActivity(tokenMarketId: string, count: number): Promise<void> {
    try {
      await this.redis.publish(
        ACTIVITY_REALTIME_CHANNEL,
        JSON.stringify({ tokenMarketId, count, atIso: new Date().toISOString() }),
      );
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Failed to publish new-activity event — feed will catch up on next poll',
      );
    }
  }

  /**
   * Upserts candles for the given time range directly from `swaps` (the authoritative
   * source). Idempotent: re-running for the same range always produces the same candle
   * rows. Only called when new swaps were actually found this tick — see
   * `recomputeRollups` for the part of the pipeline that must still run even when none were.
   */
  private async upsertCandlesFromSwaps(
    tokenMarketId: string,
    fromTs: Date,
    toTs: Date,
  ): Promise<void> {
    const paddedFrom = new Date(fromTs.getTime() - BUCKET_MINUTES * 60_000);

    await prisma.$executeRaw`
      INSERT INTO candles (token_market_id, bucket_start, open, high, low, close, volume_usd)
      SELECT
        ${tokenMarketId}::text,
        time_bucket(${`${BUCKET_MINUTES} minutes`}::interval, block_timestamp) AS bucket_start,
        (array_agg(price_usd ORDER BY block_timestamp ASC))[1] AS open,
        MAX(price_usd) AS high,
        MIN(price_usd) AS low,
        (array_agg(price_usd ORDER BY block_timestamp DESC))[1] AS close,
        SUM(volume_usd) AS volume_usd
      FROM swaps
      WHERE token_market_id = ${tokenMarketId}::text
        AND block_timestamp >= ${paddedFrom}
        AND block_timestamp <= ${toTs}
      GROUP BY 1, 2
      ON CONFLICT (token_market_id, bucket_start)
      DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                    close = EXCLUDED.close, volume_usd = EXCLUDED.volume_usd
    `;
  }

  /**
   * Refreshes the 24h volume/price-change cache on TokenMarket from `candles` (never the
   * other way around). Must run every ingestion tick — including one with zero new swaps —
   * because the 24h window is time-based, not swap-based: old candles age out of it purely
   * from wall-clock time passing, and both cached figures need to reflect that decay, not
   * hold whatever value the last tick with real activity left behind.
   */
  private async recomputeRollups(tokenMarketId: string): Promise<void> {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const volumeRows = await prisma.candle.aggregate({
      where: { tokenMarketId, bucketStart: { gte: since24h } },
      _sum: { volumeUsd: true },
    });

    // Phase 2 trending inputs — COUNT(DISTINCT trader_address) has no Prisma aggregate
    // equivalent, hence the raw query (same pattern as the candle time_bucket query above).
    // Reads directly from `swaps` (not `candles`, which don't carry a trader), still scoped
    // to the same rolling 24h window as volume24hUsd.
    // A bare aggregate with no GROUP BY always returns exactly one row, even when zero
    // swaps match — the `!` reflects that guarantee, not an assumption.
    const [activityStats] = await prisma.$queryRaw<
      { trade_count: bigint; unique_traders: bigint }[]
    >`
      SELECT COUNT(*) AS trade_count, COUNT(DISTINCT trader_address) AS unique_traders
      FROM swaps
      WHERE token_market_id = ${tokenMarketId}::text
        AND block_timestamp >= ${since24h}
    `;
    const stats = activityStats!;

    const oldestRelevantCandle = await prisma.candle.findFirst({
      where: { tokenMarketId, bucketStart: { lte: since24h } },
      orderBy: { bucketStart: 'desc' },
    });
    const oldestCandleOverall = await prisma.candle.findFirst({
      where: { tokenMarketId },
      orderBy: { bucketStart: 'asc' },
    });

    let priceChange24hPct: number | null = null;
    const current = await prisma.tokenMarket.findUniqueOrThrow({ where: { id: tokenMarketId } });
    const referenceCandle = oldestRelevantCandle ?? oldestCandleOverall;
    const haveFullDay = oldestCandleOverall !== null && oldestCandleOverall.bucketStart <= since24h;
    if (referenceCandle && current.priceUsd !== null && haveFullDay) {
      const oldPrice = Number(referenceCandle.close);
      if (oldPrice > 0) {
        priceChange24hPct = ((Number(current.priceUsd) - oldPrice) / oldPrice) * 100;
      }
    }

    // Once at least one swap has ever been indexed for this market, the 24h window is
    // fully known and must reflect it exactly — including 0 once every swap behind the
    // current figure has aged out of it. Before that first swap, `undefined` (leave the
    // column at its default null) is still the honest "unknown," not "confirmed zero" —
    // see the volume24hUsd comment on TokenMarket in schema.prisma. Same rule applies to
    // the two Phase 2 activity stats below.
    const everTraded = oldestCandleOverall !== null;
    const volume24hUsd = everTraded ? (volumeRows._sum.volumeUsd ?? 0) : undefined;
    const tradeCount24h = everTraded ? Number(stats.trade_count) : undefined;
    const uniqueTraders24h = everTraded ? Number(stats.unique_traders) : undefined;

    await prisma.tokenMarket.update({
      where: { id: tokenMarketId },
      data: {
        volume24hUsd,
        priceChange24hPct, // explicitly null until 24h of real history exists
        tradeCount24h,
        uniqueTraders24h,
      },
    });
  }

  private requireChainId(): number {
    if (this.chainId === null)
      throw new Error('MarketIngestionService.seed() must run before other methods');
    return this.chainId;
  }
}

function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
