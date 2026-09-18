import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma } from '@kamby/db';
import { PNL_WINDOW_MS, toPnlWindowStats, type LeaderboardEntry } from '@kamby/domain';
import type { Logger } from 'pino';
import { PnlLedgerSweepService } from './pnl-ledger-sweep';

/**
 * Real end-to-end proof of the realized-PnL pipeline — see
 * docs/TRADER_INTELLIGENCE.md#realized-pnl. Requires a reachable Postgres (`DATABASE_URL`),
 * same convention as apps/api's `*.e2e-spec.ts` files (never run by the default `pnpm test`
 * — see vitest.e2e.config.ts's own comment for why, and run this with `pnpm test:e2e`).
 *
 * Everything downstream of `PnlLedgerSweepService.sweep()` here is real: real Prisma rows,
 * real Postgres aggregates, the real `pg_advisory_xact_lock` path, and the exact same
 * `toPnlWindowStats`/`PNL_WINDOW_MS` (@kamby/domain) and `realized_pnl_events` GROUP BY
 * shape `TraderService#computeRealizedPnl` and `LeaderboardService#getLeaderboard`
 * (apps/api) use — reproduced inline here rather than imported cross-app (apps/workers and
 * apps/api are separate deployables, neither is a shared package the other may import from)
 * so this test proves the actual data those two api-layer services would read is correct,
 * without needing to boot the NestJS api app itself (already covered by their own
 * mocked-Prisma unit tests for the mapping/shaping logic).
 */
const fakeLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

const CHAIN_IDENTIFIER = 'eip155:8453:pnl-e2e';
const BASE_TOKEN_ADDRESS = '0xe2e0000000000000000000000000000000e2e0';
const QUOTE_TOKEN_ADDRESS = '0xe2e0000000000000000000000000000000e2e1';
const POOL_ADDRESS = '0xe2e0000000000000000000000000000000e2e2';
const BASE_TOKEN_DECIMALS = 18;

describe('Realized PnL — real BUY then SELL, end to end (e2e)', () => {
  let chainId: number;
  let tokenId: string;
  let tokenMarketId: string;
  let userId: string;
  let walletAddress: string;
  let buyTransactionId: string;
  let sellTransactionId: string;

  beforeAll(async () => {
    const chain = await prisma.chain.upsert({
      where: { identifier: CHAIN_IDENTIFIER },
      update: {},
      create: { identifier: CHAIN_IDENTIFIER, name: 'Base (PnL e2e)', nativeSymbol: 'ETH', rpcConfigKey: 'CHAIN_RPC_URL' },
    });
    chainId = chain.id;

    const baseToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId, contractAddress: BASE_TOKEN_ADDRESS } },
      update: {},
      create: { chainId, contractAddress: BASE_TOKEN_ADDRESS, symbol: 'PNLE2E', name: 'PnL e2e Token', decimals: BASE_TOKEN_DECIMALS },
    });
    tokenId = baseToken.id;

    const quoteToken = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId, contractAddress: QUOTE_TOKEN_ADDRESS } },
      update: {},
      create: { chainId, contractAddress: QUOTE_TOKEN_ADDRESS, symbol: 'PNLE2EQ', name: 'PnL e2e Quote', decimals: 6 },
    });

    const market = await prisma.tokenMarket.upsert({
      where: { chainId_pairAddress: { chainId, pairAddress: POOL_ADDRESS } },
      update: {},
      create: {
        chainId,
        tokenId,
        quoteTokenId: quoteToken.id,
        dex: 'uniswap-v3',
        pairAddress: POOL_ADDRESS,
        feeTier: 3000,
        priceUsd: 2,
        liquidityUsd: 1_000_000,
        lastPriceUpdateAt: new Date(),
      },
    });
    tokenMarketId = market.id;

    const user = await prisma.user.create({ data: { referralCode: `PNLE2E${Date.now()}` } });
    userId = user.id;

    walletAddress = `0xe2e${Date.now().toString(16).padStart(37, '0')}`;
    await prisma.wallet.create({
      data: { address: walletAddress, chain: 'EVM', userId, firstSeenAt: new Date(), verifiedAt: new Date() },
    });
  }, 30_000);

  afterAll(async () => {
    // Reverse dependency order — every row this test created, nothing it didn't.
    await prisma.realizedPnlEvent.deleteMany({ where: { userId } });
    await prisma.tokenLot.deleteMany({ where: { userId } });
    await prisma.tradeTransaction.deleteMany({ where: { userId } });
    await prisma.tradeQuote.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.tokenMarket.delete({ where: { id: tokenMarketId } }).catch(() => undefined);
    await prisma.token.deleteMany({ where: { chainId } });
    await prisma.chain.delete({ where: { id: chainId } }).catch(() => undefined);
  });

  it('seeds a real CONFIRMED BUY then a real CONFIRMED partial SELL', async () => {
    // BUY: acquire 100 tokens at $2.00/token — cost basis $200.00.
    const buyQuote = await prisma.tradeQuote.create({
      data: {
        userId,
        walletAddress,
        chainId,
        side: 'BUY',
        tokenMarketId,
        inputToken: QUOTE_TOKEN_ADDRESS,
        outputToken: BASE_TOKEN_ADDRESS,
        inputAmount: '200000000',
        expectedOutputAmount: '100000000000000000000', // 100 * 10^18
        minOutputAmount: '99500000000000000000',
        priceUsd: 2,
        slippageBps: 50,
        platformFeeBps: 50,
        platformFeeAmount: '500000000000000000',
        provider: 'kyberswap',
        unsignedTx: { to: '0x000000000000000000000000000000deadbeef', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const buyConfirmedAt = new Date(Date.now() - 60_000);
    const buyTx = await prisma.tradeTransaction.create({
      data: {
        userId,
        walletAddress,
        quoteId: buyQuote.id,
        chainId,
        txHash: `0x${'1'.repeat(64)}`,
        tokenMarketId,
        side: 'BUY',
        inputToken: QUOTE_TOKEN_ADDRESS,
        outputToken: BASE_TOKEN_ADDRESS,
        inputAmount: buyQuote.inputAmount,
        expectedOutputAmount: buyQuote.expectedOutputAmount,
        platformFeeAmount: buyQuote.platformFeeAmount,
        status: 'CONFIRMED',
        confirmedAt: buyConfirmedAt,
      },
    });
    buyTransactionId = buyTx.id;

    // SELL: sell 40 of the 100 held tokens at $3.00/token — proceeds $120.00.
    const sellQuote = await prisma.tradeQuote.create({
      data: {
        userId,
        walletAddress,
        chainId,
        side: 'SELL',
        tokenMarketId,
        inputToken: BASE_TOKEN_ADDRESS,
        outputToken: QUOTE_TOKEN_ADDRESS,
        inputAmount: '40000000000000000000', // 40 * 10^18
        expectedOutputAmount: '120000000',
        minOutputAmount: '119000000',
        priceUsd: 3,
        slippageBps: 50,
        platformFeeBps: 50,
        platformFeeAmount: '600000',
        provider: 'kyberswap',
        unsignedTx: { to: '0x000000000000000000000000000000deadbeef', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const sellConfirmedAt = new Date();
    const sellTx = await prisma.tradeTransaction.create({
      data: {
        userId,
        walletAddress,
        quoteId: sellQuote.id,
        chainId,
        txHash: `0x${'2'.repeat(64)}`,
        tokenMarketId,
        side: 'SELL',
        inputToken: BASE_TOKEN_ADDRESS,
        outputToken: QUOTE_TOKEN_ADDRESS,
        inputAmount: sellQuote.inputAmount,
        expectedOutputAmount: sellQuote.expectedOutputAmount,
        platformFeeAmount: sellQuote.platformFeeAmount,
        status: 'CONFIRMED',
        confirmedAt: sellConfirmedAt,
      },
    });
    sellTransactionId = sellTx.id;

    expect(buyTx.status).toBe('CONFIRMED');
    expect(sellTx.status).toBe('CONFIRMED');
  }, 30_000);

  it('the real sweep creates a correctly-priced lot and FIFO-matches the sell against it', async () => {
    const service = new PnlLedgerSweepService(fakeLogger);
    const result = await service.sweep();

    expect(result.checked).toBeGreaterThanOrEqual(2);
    expect(result.lotsCreated).toBeGreaterThanOrEqual(1);
    expect(result.eventsCreated).toBeGreaterThanOrEqual(1);
    expect(result.skippedNoPrice).toBe(0);

    const [buyTx, sellTx] = await Promise.all([
      prisma.tradeTransaction.findUniqueOrThrow({ where: { id: buyTransactionId } }),
      prisma.tradeTransaction.findUniqueOrThrow({ where: { id: sellTransactionId } }),
    ]);
    expect(buyTx.pnlProcessedAt).not.toBeNull();
    expect(sellTx.pnlProcessedAt).not.toBeNull();

    const lot = await prisma.tokenLot.findUniqueOrThrow({ where: { evmBuyTransactionId: buyTransactionId } });
    expect(lot.userId).toBe(userId);
    expect(lot.evmTokenId).toBe(tokenId);
    expect(lot.quantityOriginalRaw).toBe('100000000000000000000');
    // 100 sold down to 60 remaining after the 40-token sell.
    expect(lot.quantityRemainingRaw).toBe('60000000000000000000');
    expect(Number(lot.costBasisUsd)).toBeCloseTo(200, 6);

    const events = await prisma.realizedPnlEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.lotId).toBe(lot.id);
    expect(event.evmSellTransactionId).toBe(sellTransactionId);
    expect(event.quantityMatchedRaw).toBe('40000000000000000000');
    // Matched cost basis: (40/100) * $200 = $80.
    expect(Number(event.costBasisUsd)).toBeCloseTo(80, 6);
    // Proceeds: 40 tokens * $3.00 = $120.
    expect(Number(event.proceedsUsd)).toBeCloseTo(120, 6);
    // Realized PnL: $120 - $80 = $40.
    expect(Number(event.realizedPnlUsd)).toBeCloseTo(40, 6);
  }, 30_000);

  it('a second sweep tick is a true no-op — every row is already pnlProcessedAt, nothing is double-counted', async () => {
    const service = new PnlLedgerSweepService(fakeLogger);
    const before = await prisma.realizedPnlEvent.count({ where: { userId } });

    const result = await service.sweep();
    // Rows from THIS test's fixtures are already processed; `checked` may be nonzero from
    // unrelated rows elsewhere in a shared dev DB, so the real assertion is on this test's
    // own event count staying put, not on `result` being globally zero.
    void result;

    const after = await prisma.realizedPnlEvent.count({ where: { userId } });
    expect(after).toBe(before);
  }, 30_000);

  it('flows into the real leaderboard aggregate — the exact GROUP BY LeaderboardService#getLeaderboard runs', async () => {
    const since = new Date(Date.now() - PNL_WINDOW_MS['24h']);
    const grouped = await prisma.realizedPnlEvent.groupBy({
      by: ['userId'],
      where: { confirmedAt: { gte: since } },
      _sum: { realizedPnlUsd: true, costBasisUsd: true, proceedsUsd: true },
      orderBy: { _sum: { realizedPnlUsd: 'desc' } },
    });

    const row = grouped.find((g) => g.userId === userId);
    expect(row).toBeDefined();

    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId, verifiedAt: { not: null } } });
    const entry: LeaderboardEntry = {
      userId,
      username: null,
      avatarUrl: null,
      walletAddress: wallet.address,
      realizedPnlUsd: Number(row!._sum.realizedPnlUsd),
      realizedPnlPct:
        Number(row!._sum.costBasisUsd) > 0
          ? (Number(row!._sum.realizedPnlUsd) / Number(row!._sum.costBasisUsd)) * 100
          : null,
      volumeUsd: Number(row!._sum.costBasisUsd) + Number(row!._sum.proceedsUsd),
    };

    expect(entry.realizedPnlUsd).toBeCloseTo(40, 6);
    expect(entry.realizedPnlPct).toBeCloseTo(50, 6); // 40 / 80 * 100
    expect(entry.volumeUsd).toBeCloseTo(200, 6); // 80 matched cost basis + 120 proceeds
    expect(entry.walletAddress).toBe(walletAddress);
  }, 30_000);

  it("flows into the real trader-profile aggregate — the exact per-window query TraderService#computeRealizedPnl runs, through toPnlWindowStats", async () => {
    for (const window of ['24h', '7d', '30d'] as const) {
      const since = new Date(Date.now() - PNL_WINDOW_MS[window]);
      const agg = await prisma.realizedPnlEvent.aggregate({
        where: { userId, confirmedAt: { gte: since } },
        _sum: { realizedPnlUsd: true, costBasisUsd: true, proceedsUsd: true },
        _count: { _all: true },
      });

      const stats = toPnlWindowStats(window, {
        realizedPnlUsd: agg._sum.realizedPnlUsd === null ? 0 : Number(agg._sum.realizedPnlUsd),
        costBasisUsd: agg._sum.costBasisUsd === null ? 0 : Number(agg._sum.costBasisUsd),
        proceedsUsd: agg._sum.proceedsUsd === null ? 0 : Number(agg._sum.proceedsUsd),
        matchedCount: agg._count._all,
      });

      // The sell was confirmed "now" in beforeAll — real inside every window.
      expect(stats.realizedPnlUsd).toBeCloseTo(40, 6);
      expect(stats.realizedPnlPct).toBeCloseTo(50, 6);
      expect(stats.volumeUsd).toBeCloseTo(200, 6);
    }
  }, 30_000);
});
