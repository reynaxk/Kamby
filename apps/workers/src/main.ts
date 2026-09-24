import { parseEnv } from '@kamby/domain';
import { EvmChainDataProvider } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import { Connection } from '@solana/web3.js';
import { Redis } from 'ioredis';
import { EnvSchema } from './config/env';
import { createLogger } from './lib/logger';
import { MarketIngestionService } from './market/ingestion';
import { PoolDiscoveryService } from './market/pool-discovery';
import { SEED_MARKETS_BY_CHAIN_IDENTIFIER } from './market/seed-markets';
import { PnlLedgerSweepService } from './pnl/pnl-ledger-sweep';
import { PumpFunIngestionService } from './pumpfun/pumpfun-ingestion';
import { SolanaSweepService } from './solana/solana-sweep';
import { checkTreasuryBalances, type MonitoredWallet } from './solana/treasury-balance-monitor';
import { checkEvmRelayerBalance } from './trading/evm-relayer-balance-monitor';
import { TradeSweepService } from './trading/sweep';

/**
 * Phase 0 proved DB, Redis, and the chain adapter all connect, and that the process
 * starts and stops cleanly. Phase 1 adds the real payload: seed the tracked markets, then
 * tick price/liquidity refresh and incremental swap ingestion on a timer. See
 * /docs/SOURCE_OF_TRUTH.md and /docs/MARKET_DATA.md.
 */
async function main(): Promise<void> {
  const env = parseEnv(EnvSchema, process.env);
  const logger = createLogger(env);

  logger.info('Worker starting');

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  // Without a listener, ioredis dumps reconnect errors straight to stderr, bypassing
  // structured logging entirely — route them through the same logger everything else uses.
  redis.on('error', (error) => logger.error({ err: error }, 'Redis client error'));

  const redisReady = await redis
    .ping()
    .then((reply) => reply === 'PONG')
    .catch((error: Error) => {
      logger.error({ err: error }, 'Redis connectivity check failed');
      return false;
    });
  logger.info({ redisReady }, 'Redis connectivity check');

  const dbReady = await prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch((error: Error) => {
      logger.error({ err: error }, 'Database connectivity check failed');
      return false;
    });
  logger.info({ dbReady }, 'Database connectivity check');

  const chainAdapter = new EvmChainDataProvider({
    chain: {
      identifier: env.CHAIN_IDENTIFIER,
      name: env.CHAIN_NAME,
      nativeSymbol: env.CHAIN_NATIVE_SYMBOL,
    },
    rpcUrl: env.CHAIN_RPC_URL,
    rpcUrlFallback: env.CHAIN_RPC_URL_FALLBACK ?? null,
  });
  const chainReady = await chainAdapter.isHealthy();
  logger.info({ chain: chainAdapter.chain.identifier, chainReady }, 'Chain adapter connectivity check');

  const heartbeat = setInterval(() => {
    logger.info({ uptimeSeconds: Math.round(process.uptime()) }, 'Worker heartbeat');
  }, env.HEARTBEAT_INTERVAL_SECONDS * 1000);
  heartbeat.unref();

  // Informational only, logged once at startup — NOT used to gate whether the tickers
  // below ever start. Confirmed in production (2026-09-13): a startup-moment RPC outage
  // (a provider's daily quota exhausted, mid-provider-migration flakiness, etc.) used to
  // set `chainReady` false exactly once and permanently disable market ingestion and trade
  // sweep for the container's entire lifetime — quietly "Online" in Railway, doing nothing,
  // until someone noticed and manually restarted it. Each tick already retries on its own
  // schedule and self-heals via its own try/catch (see `ingestion.seed()`'s identical
  // reasoning below) once the underlying outage clears, exactly like a mid-lifetime DB or
  // RPC hiccup already does — there's no reason a hiccup at t=0 should be treated
  // differently from one at t=+5min.
  if (!dbReady) logger.warn('Database was not reachable at startup — ticks below will retry on their own schedule');
  if (!chainReady) {
    logger.warn('Chain adapter was not reachable at startup (RPC outage/quota) — ticks below will retry on their own schedule');
  }

  // Every ticker below fires its first run without awaiting it (`void runX()`, not
  // `await runX()`), then immediately falls through to set up the next one — so market
  // ingestion, the EVM sweep, the Solana sweep, and the Pump.fun subscription all genuinely
  // start in parallel instead of one after another. This used to be sequential, which meant
  // `Worker ready` — and specifically the Pump.fun subscription, set up last — didn't fire
  // until every earlier ticker's first run had fully finished. Confirmed in production
  // (2026-09-15): the market ingestion tick alone took 88s on a cold start (dominated by the
  // old LOG_CHUNK_BLOCKS=5 chunking — see ingestion.ts), so Pump.fun ingestion silently
  // didn't start for the first minute and a half after every redeploy. Each ticker already
  // tolerates a delayed or skipped first run via its own `xRunning` reentrancy guard and
  // internal try/catch (neither rethrows — `await`ing one was never load-bearing for error
  // handling either), so there's no correctness reason to serialize them at startup.
  // Fails loudly at boot, not silently, if this deployment's CHAIN_IDENTIFIER has no
  // curated seed list — added 2026-09-16 alongside BNB Chain going live, when
  // MarketIngestionService stopped assuming its one configured chain was always Base. See
  // SEED_MARKETS_BY_CHAIN_IDENTIFIER's own doc comment in market/seed-markets.ts. Hoisted
  // above both tickers below (2026-09-24, pool discovery added): PoolDiscoveryService needs
  // this same quoteUsdcAddress too, and re-deriving it a second time independently would
  // just be a second place this same "fail loudly if unconfigured" check could drift.
  const seedConfig = SEED_MARKETS_BY_CHAIN_IDENTIFIER[env.CHAIN_IDENTIFIER];
  if (!seedConfig) {
    throw new Error(
      `No curated seed markets for CHAIN_IDENTIFIER "${env.CHAIN_IDENTIFIER}" — add an entry to SEED_MARKETS_BY_CHAIN_IDENTIFIER in market/seed-markets.ts before deploying a workers instance for this chain.`,
    );
  }

  let marketTicker: NodeJS.Timeout | undefined;
  {
    const ingestion = new MarketIngestionService(
      {
        chainIdentifier: env.CHAIN_IDENTIFIER,
        chainName: env.CHAIN_NAME,
        chainNativeSymbol: env.CHAIN_NATIVE_SYMBOL,
        rpcConfigKey: 'CHAIN_RPC_URL',
        seedMarkets: seedConfig.seedMarkets,
        quoteUsdcAddress: seedConfig.quoteUsdcAddress,
      },
      env.CHAIN_RPC_URL,
      logger,
      redis,
      env.WHALE_TRADE_USD_THRESHOLD,
      env.CHAIN_RPC_URL_FALLBACK ?? null,
    );

    let tickRunning = false;
    const runTick = async (): Promise<void> => {
      if (tickRunning) {
        logger.warn('Skipped market ingestion tick: previous tick still running');
        return;
      }
      tickRunning = true;
      const startedAt = Date.now();
      try {
        // `seed()` is documented as idempotent and safe to call every tick — previously it
        // only ran once at process startup, so a single flaky RPC read during that one
        // attempt (the free public Base RPC does this under load) permanently left a
        // market unseeded or a token's metadata null for the container's entire lifetime,
        // with no actual retry despite the error log below claiming one would happen. It's
        // a small, fixed list of seed markets (this deployment's own entry in
        // SEED_MARKETS_BY_CHAIN_IDENTIFIER), so re-checking them every tick is cheap and
        // lets a transient failure self-heal on a later tick instead of requiring a
        // manual restart.
        await ingestion.seed();
        await ingestion.refreshPricesAndLiquidity();
        await ingestion.ingestSwaps();
        logger.info({ durationMs: Date.now() - startedAt }, 'Market ingestion tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Market ingestion tick failed — will retry next tick');
      } finally {
        tickRunning = false;
      }
    };

    void runTick();
    marketTicker = setInterval(() => void runTick(), env.MARKET_INGESTION_INTERVAL_SECONDS * 1000);
    marketTicker.unref();
  }

  // Automated pool discovery — see market/pool-discovery.ts's own class doc comment for
  // what this does and doesn't do. Opt-in per deployment (env.ts's own superRefine requires
  // the factory address and dex once enabled), independent of the seed-list-driven ticker
  // above: a discovered pool that clears its liquidity floor becomes a real TokenMarket row
  // through the exact same createTrackedMarket() path a seeded pool uses, so it's picked up
  // by that ticker's own ingestSwaps()/refreshPricesAndLiquidity() from then on — this
  // ticker's only job is finding and vetting candidates, not ongoing price refresh.
  let poolDiscoveryTicker: NodeJS.Timeout | undefined;
  if (env.POOL_DISCOVERY_ENABLED) {
    const discovery = new PoolDiscoveryService(
      {
        chainIdentifier: env.CHAIN_IDENTIFIER,
        chainName: env.CHAIN_NAME,
        chainNativeSymbol: env.CHAIN_NATIVE_SYMBOL,
        factoryAddress: env.POOL_DISCOVERY_FACTORY_ADDRESS!,
        quoteUsdcAddress: seedConfig.quoteUsdcAddress,
        dex: env.POOL_DISCOVERY_DEX!,
        liquidityFloorUsd: env.POOL_DISCOVERY_LIQUIDITY_FLOOR_USD,
      },
      env.CHAIN_RPC_URL,
      logger,
      redis,
      env.CHAIN_RPC_URL_FALLBACK ?? null,
    );

    let discoveryRunning = false;
    const runDiscoveryTick = async (): Promise<void> => {
      if (discoveryRunning) {
        logger.warn('Skipped pool discovery tick: previous tick still running');
        return;
      }
      discoveryRunning = true;
      const startedAt = Date.now();
      try {
        const discovered = await discovery.discoverNewPools();
        const pending = await discovery.checkPendingPools();
        logger.info({ ...discovered, ...pending, durationMs: Date.now() - startedAt }, 'Pool discovery tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Pool discovery tick failed — will retry next tick');
      } finally {
        discoveryRunning = false;
      }
    };

    void runDiscoveryTick();
    poolDiscoveryTicker = setInterval(() => void runDiscoveryTick(), env.POOL_DISCOVERY_INTERVAL_SECONDS * 1000);
    poolDiscoveryTicker.unref();
  }

  // The real numeric EVM chain id (e.g. 8453) that TradeTransaction.chainId is stored
  // as — distinct from Chain.id (an internal DB row id) and not itself a separate env var,
  // since CHAIN_IDENTIFIER (a CAIP-2 string, "eip155:8453") already names it authoritatively.
  const tradeChainId = Number(env.CHAIN_IDENTIFIER.split(':')[1]);

  let tradeSweepTicker: NodeJS.Timeout | undefined;
  if (Number.isInteger(tradeChainId)) {
    const sweep = new TradeSweepService(tradeChainId, chainAdapter, logger);

    let sweepRunning = false;
    const runSweep = async (): Promise<void> => {
      if (sweepRunning) {
        logger.warn('Skipped trade sweep tick: previous tick still running');
        return;
      }
      sweepRunning = true;
      const startedAt = Date.now();
      try {
        const result = await sweep.sweepPendingTransactions();
        logger.info({ ...result, durationMs: Date.now() - startedAt }, 'Trade sweep tick complete');
        // See docs/TRADING.md#guaranteed-usdc-fees — a separate, independent sweep for the
        // fee-transfer leg of trades on that flow. Never blocks or is blocked by the swap
        // sweep above; a swap and its fee transfer confirm on their own timelines.
        const feeResult = await sweep.sweepPendingFeeTransactions();
        logger.info({ ...feeResult, durationMs: Date.now() - startedAt }, 'Fee transfer sweep tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Trade sweep tick failed — will retry next tick');
      } finally {
        sweepRunning = false;
      }
    };

    void runSweep();
    tradeSweepTicker = setInterval(() => void runSweep(), env.TRADE_SWEEP_INTERVAL_SECONDS * 1000);
    tradeSweepTicker.unref();
  } else {
    logger.warn({ tradeChainId }, 'Trade sweep disabled: CHAIN_IDENTIFIER is not a parseable eip155 chain id');
  }

  // EVM gas relayer balance monitoring — see trading/evm-relayer-balance-monitor.ts's own
  // doc comment. Independent of tradeSweepTicker's tradeChainId gating above (a relayer
  // balance check needs only a chain id string for logging, not a parsed numeric one) and
  // of the SOLANA_ENABLED block below — this deployment's own single configured EVM chain
  // is all it ever watches. Opt-in via EVM_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY alone, same
  // "unset = skip cleanly" convention every other optional monitor here already follows.
  let evmRelayerBalanceMonitorTicker: NodeJS.Timeout | undefined;
  if (env.EVM_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY) {
    let evmRelayerMonitorRunning = false;
    const runEvmRelayerMonitor = async (): Promise<void> => {
      if (evmRelayerMonitorRunning) {
        logger.warn('Skipped EVM gas relayer balance monitor tick: previous tick still running');
        return;
      }
      evmRelayerMonitorRunning = true;
      try {
        await checkEvmRelayerBalance(
          env.CHAIN_RPC_URL,
          env.CHAIN_RPC_URL_FALLBACK ?? null,
          env.EVM_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY!,
          BigInt(env.EVM_GAS_RELAYER_WARN_THRESHOLD_WEI),
          logger,
        );
      } catch (error) {
        logger.error({ err: error }, 'EVM gas relayer balance monitor tick failed — will retry next tick');
      } finally {
        evmRelayerMonitorRunning = false;
      }
    };

    void runEvmRelayerMonitor();
    evmRelayerBalanceMonitorTicker = setInterval(() => void runEvmRelayerMonitor(), env.EVM_GAS_RELAYER_BALANCE_MONITOR_INTERVAL_SECONDS * 1000);
    evmRelayerBalanceMonitorTicker.unref();
  } else {
    logger.info('EVM gas relayer balance monitoring disabled (EVM_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY unset)');
  }

  // Solana's counterpart to the EVM trade sweep above — see solana/solana-sweep.ts's own
  // doc comment. Entirely independent of the EVM ticker's chainId gating; gated on
  // SOLANA_ENABLED alone, same convention apps/api's own Solana feature flag already uses.
  let solanaSweepTicker: NodeJS.Timeout | undefined;
  let treasuryMonitorTicker: NodeJS.Timeout | undefined;
  if (env.SOLANA_ENABLED) {
    const solanaConnection = new Connection(env.SOLANA_RPC_URL!, 'confirmed');
    const solanaFallbackConnection = env.SOLANA_RPC_URL_FALLBACK ? new Connection(env.SOLANA_RPC_URL_FALLBACK, 'confirmed') : null;
    const solanaSweep = new SolanaSweepService(solanaConnection, solanaFallbackConnection, redis, logger);

    let solanaSweepRunning = false;
    const runSolanaSweep = async (): Promise<void> => {
      if (solanaSweepRunning) {
        logger.warn('Skipped Solana sweep tick: previous tick still running');
        return;
      }
      solanaSweepRunning = true;
      const startedAt = Date.now();
      try {
        const result = await solanaSweep.sweepPendingTransactions();
        logger.info({ ...result, durationMs: Date.now() - startedAt }, 'Solana sweep tick complete');
      } catch (error) {
        logger.error({ err: error }, 'Solana sweep tick failed — will retry next tick');
      } finally {
        solanaSweepRunning = false;
      }
    };

    void runSolanaSweep();
    solanaSweepTicker = setInterval(() => void runSolanaSweep(), env.SOLANA_SWEEP_INTERVAL_SECONDS * 1000);
    solanaSweepTicker.unref();

    // Treasury balance monitoring for this deployment's small, manually-funded operational
    // Solana wallets — see solana/treasury-balance-monitor.ts's own doc comment for why this
    // gap mattered (neither wallet auto-refills, and until now neither was monitored at
    // all). Reuses solanaConnection above rather than a second client. Each of the two
    // wallets is independently opt-in via its own *_PUBLIC_KEY env var — skips cleanly, with
    // one explanatory log line, if neither is configured (a valid, common pre-launch state).
    const monitoredWallets: MonitoredWallet[] = [];
    if (env.SOLANA_TOPUP_FUNDING_PUBLIC_KEY) {
      monitoredWallets.push({ label: 'solana-topup-funding', publicKey: env.SOLANA_TOPUP_FUNDING_PUBLIC_KEY, warnThresholdLamports: env.SOLANA_TOPUP_WARN_THRESHOLD_LAMPORTS });
    }
    if (env.SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY) {
      monitoredWallets.push({
        label: 'solana-gas-relayer',
        publicKey: env.SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY,
        warnThresholdLamports: env.SOLANA_GAS_RELAYER_WARN_THRESHOLD_LAMPORTS,
      });
    }

    if (monitoredWallets.length > 0) {
      let treasuryMonitorRunning = false;
      const runTreasuryMonitor = async (): Promise<void> => {
        if (treasuryMonitorRunning) {
          logger.warn('Skipped treasury balance monitor tick: previous tick still running');
          return;
        }
        treasuryMonitorRunning = true;
        try {
          await checkTreasuryBalances(solanaConnection, monitoredWallets, logger);
        } catch (error) {
          logger.error({ err: error }, 'Treasury balance monitor tick failed — will retry next tick');
        } finally {
          treasuryMonitorRunning = false;
        }
      };

      void runTreasuryMonitor();
      treasuryMonitorTicker = setInterval(() => void runTreasuryMonitor(), env.SOLANA_TREASURY_MONITOR_INTERVAL_SECONDS * 1000);
      treasuryMonitorTicker.unref();
    } else {
      logger.info('No treasury wallets configured for balance monitoring (SOLANA_TOPUP_FUNDING_PUBLIC_KEY / SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY both unset)');
    }
  }

  // Pump.fun bonding-curve ingestion — see pumpfun/pumpfun-ingestion.ts's own doc comment
  // on why this is a persistent subscription, not a tick like everything else above.
  let pumpFunIngestion: PumpFunIngestionService | undefined;
  if (env.PUMPFUN_INGESTION_ENABLED) {
    const wsUrl = env.SOLANA_RPC_URL!.replace(/^http/, 'ws');
    pumpFunIngestion = new PumpFunIngestionService(env.SOLANA_RPC_URL!, wsUrl, logger);
    pumpFunIngestion.start();
  }

  // Realized-PnL ledger sweep — see pnl/pnl-ledger-sweep.ts's own doc comment and
  // PNL_LEDGER_SWEEP_ENABLED's in config/env.ts. Deliberately cross-chain (reads both
  // trade_transactions and solana_trade_transactions regardless of this deployment's own
  // CHAIN_IDENTIFIER) — must be enabled on exactly ONE workers deployment, never every
  // per-chain replica, or the same backlog gets raced concurrently (the sweep's own
  // Postgres advisory lock is a correctness backstop for that, not a license to enable it
  // everywhere).
  let pnlSweepTicker: NodeJS.Timeout | undefined;
  if (env.PNL_LEDGER_SWEEP_ENABLED) {
    const pnlSweep = new PnlLedgerSweepService(logger);

    let pnlSweepRunning = false;
    const runPnlSweep = async (): Promise<void> => {
      if (pnlSweepRunning) {
        logger.warn('Skipped PnL ledger sweep tick: previous tick still running');
        return;
      }
      pnlSweepRunning = true;
      const startedAt = Date.now();
      try {
        const result = await pnlSweep.sweep();
        logger.info({ ...result, durationMs: Date.now() - startedAt }, 'PnL ledger sweep tick complete');
      } catch (error) {
        logger.error({ err: error }, 'PnL ledger sweep tick failed — will retry next tick');
      } finally {
        pnlSweepRunning = false;
      }
    };

    void runPnlSweep();
    pnlSweepTicker = setInterval(() => void runPnlSweep(), env.PNL_LEDGER_SWEEP_INTERVAL_SECONDS * 1000);
    pnlSweepTicker.unref();
  }

  logger.info('Worker ready');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    clearInterval(heartbeat);
    if (marketTicker) clearInterval(marketTicker);
    if (poolDiscoveryTicker) clearInterval(poolDiscoveryTicker);
    if (tradeSweepTicker) clearInterval(tradeSweepTicker);
    if (evmRelayerBalanceMonitorTicker) clearInterval(evmRelayerBalanceMonitorTicker);
    if (solanaSweepTicker) clearInterval(solanaSweepTicker);
    if (treasuryMonitorTicker) clearInterval(treasuryMonitorTicker);
    if (pnlSweepTicker) clearInterval(pnlSweepTicker);
    await Promise.allSettled([pumpFunIngestion?.stop() ?? Promise.resolve(), redis.quit(), prisma.$disconnect()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Worker failed to start', error);
  process.exit(1);
});
