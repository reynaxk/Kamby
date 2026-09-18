import { prisma, type Prisma } from '@kamby/db';
import { computeFifoRealizedPnl, SOLANA_USDC_MINT, type OpenLot } from '@kamby/domain';
import type { Logger } from 'pino';

/** Bounds one sweep tick's DB work — same philosophy as MarketIngestionService's
 *  MAX_BLOCKS_PER_TICK and TradeSweepService's own BATCH_SIZE: a large backlog simply
 *  continues over several ticks, never processed in one unbounded query. */
const BATCH_SIZE = 50;

export interface PnlSweepResult {
  checked: number;
  lotsCreated: number;
  eventsCreated: number;
  skippedNoPrice: number;
}

/** Converts a raw pre-decimals integer (as a string) to a decimal number without ever
 *  casting the full raw magnitude through `Number` directly, which loses precision fast
 *  for an 18-decimal token amount well beyond Number.MAX_SAFE_INTEGER. The final result is
 *  still an approximation — same disclosed-approximation status every figure in this file
 *  already carries (see this file's own doc comment) — this just keeps that loss to the
 *  very last, dollar-scale step instead of the raw-integer one. */
function rawToDecimal(raw: string, decimals: number): number {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  return Number(whole) + Number(fraction) / Number(base);
}

const USDC_DECIMALS = 6;

/** Everything this class does inside one `withUserTokenLock` section must run through
 *  this transaction client, never the module-level `prisma` — see that method's own doc
 *  comment for why: the advisory lock only actually serializes/atomically-groups work
 *  that runs on the SAME transaction it was acquired on. */
type Tx = Prisma.TransactionClient;

/**
 * Builds the realized-PnL ledger — `TokenLot` on every CONFIRMED BUY, `RealizedPnlEvent`
 * on every CONFIRMED SELL (FIFO-matched against that user's own open lots) — from
 * `trade_transactions` and `solana_trade_transactions`. See
 * docs/TRADER_INTELLIGENCE.md#realized-pnl for the full methodology; this class is the one
 * piece of it that touches Postgres — the actual matching math is
 * `computeFifoRealizedPnl` in `@kamby/domain`, pure and independently tested.
 *
 * Deliberately asynchronous and decoupled from trade confirmation itself — NOT hooked into
 * any of the four places a trade's `status` actually flips to CONFIRMED
 * (`apps/api`'s `TransactionService`/`SolanaTransactionService`, `apps/workers`'
 * `TradeSweepService`/`SolanaSweepService`). Hooking in there would mean duplicating this
 * logic across two runtimes, and — the sharper reason — `apps/workers` runs one replica
 * *per EVM chain* by design (`main.ts`'s `CHAIN_IDENTIFIER`), while a user's PnL spans
 * every chain they trade on; this service scans both transaction tables in one place
 * regardless of this deployment's own configured chain, and must only ever run on ONE
 * deployment (see `PNL_LEDGER_SWEEP_ENABLED`'s own doc comment in config/env.ts) rather
 * than being naturally chain-partitioned the way the existing sweeps are.
 *
 * Marks `pnlProcessedAt` exactly once per row, success or "skipped, no price" alike — never
 * retried forever waiting on a price (`TokenMarket.priceUsd`/quote.priceUsd) that's
 * documented as possibly staying unknown. Each row's read-then-write (open lots, in the
 * SELL case) runs inside a `pg_advisory_xact_lock`-guarded transaction, scoped to
 * `(userId, chain, token)` — this codebase's first use of an advisory lock, needed because
 * correctness here depends on reading several existing `TokenLot` rows before writing them
 * back consistently, unlike every earlier sweep/claim in this codebase, which only ever
 * needed a single-row atomic update.
 */
export class PnlLedgerSweepService {
  constructor(private readonly logger: Logger) {}

  async sweep(): Promise<PnlSweepResult> {
    const result: PnlSweepResult = { checked: 0, lotsCreated: 0, eventsCreated: 0, skippedNoPrice: 0 };

    const [evmRows, solanaRows] = await Promise.all([
      prisma.tradeTransaction.findMany({
        where: { status: 'CONFIRMED', pnlProcessedAt: null },
        orderBy: { confirmedAt: 'asc' },
        take: BATCH_SIZE,
        include: { quote: true, tokenMarket: { include: { token: true } } },
      }),
      prisma.solanaTradeTransaction.findMany({
        where: { status: 'CONFIRMED', pnlProcessedAt: null },
        orderBy: { confirmedAt: 'asc' },
        take: BATCH_SIZE,
        include: { quote: true },
      }),
    ]);

    for (const row of evmRows) {
      result.checked += 1;
      try {
        const processed = await this.processEvmRow(row);
        if (!processed) result.skippedNoPrice += 1;
        else if (row.side === 'BUY') result.lotsCreated += 1;
        else result.eventsCreated += 1;
      } catch (error) {
        this.logger.error({ err: error, transactionId: row.id }, 'pnl sweep: failed to process one EVM transaction — will retry next tick');
      }
    }

    for (const row of solanaRows) {
      result.checked += 1;
      try {
        await this.processSolanaRow(row);
        if (row.side === 'BUY') result.lotsCreated += 1;
        else result.eventsCreated += 1;
      } catch (error) {
        this.logger.error({ err: error, transactionId: row.id }, 'pnl sweep: failed to process one Solana transaction — will retry next tick');
      }
    }

    return result;
  }

  /** Returns `false` (and only marks `pnlProcessedAt`) when the quote had no `priceUsd` to
   *  work from, or the token's decimals aren't known yet — see this class's own doc
   *  comment on why that's a real, non-retried skip rather than an error. */
  private async processEvmRow(row: EvmSweepRow): Promise<boolean> {
    const priceUsd = row.quote.priceUsd === null ? null : Number(row.quote.priceUsd);
    const decimals = row.tokenMarket.token.decimals;
    if (priceUsd === null || decimals === null) {
      await prisma.tradeTransaction.update({ where: { id: row.id }, data: { pnlProcessedAt: new Date() } });
      this.logger.info(
        { transactionId: row.id, reason: priceUsd === null ? 'no priceUsd' : 'no token decimals' },
        'pnl sweep: skipped EVM transaction',
      );
      return false;
    }

    const tokenKey = row.tokenMarket.tokenId;
    const confirmedAt = row.confirmedAt ?? new Date();

    await this.withUserTokenLock(row.userId, 'EVM', tokenKey, async (tx) => {
      if (row.side === 'BUY') {
        // Cost basis is priced off the ACQUIRED (base-token) quantity, not the amount
        // spent — quote.priceUsd is always the base token's own USD price (see
        // QuoteService#createQuote), regardless of which token was actually spent to buy
        // it, so this is the one figure available uniformly whether or not this market
        // happens to be USDC-quoted.
        const quantityRaw = row.expectedOutputAmount;
        const costBasisUsd = rawToDecimal(quantityRaw, decimals) * priceUsd;
        await tx.tokenLot.create({
          data: {
            userId: row.userId,
            chain: 'EVM',
            evmTokenId: tokenKey,
            evmBuyTransactionId: row.id,
            quantityOriginalRaw: quantityRaw,
            quantityRemainingRaw: quantityRaw,
            costBasisUsd,
            acquiredAt: confirmedAt,
          },
        });
      } else {
        const quantityRaw = row.inputAmount;
        const proceedsUsd = rawToDecimal(quantityRaw, decimals) * priceUsd;
        await this.matchAndRecordSell(tx, {
          userId: row.userId,
          chain: 'EVM',
          evmTokenId: tokenKey,
          solanaMint: null,
          sellQuantityRaw: quantityRaw,
          sellProceedsUsd: proceedsUsd,
          confirmedAt,
          evmSellTransactionId: row.id,
          solanaSellTransactionId: null,
        });
      }
      await tx.tradeTransaction.update({ where: { id: row.id }, data: { pnlProcessedAt: new Date() } });
    });

    return true;
  }

  /**
   * Solana's counterpart to `processEvmRow` — genuinely simpler, not just structurally
   * mirrored: `SolanaTradeQuote.priceUsd` is never actually populated (confirmed against
   * `SolanaQuoteService#createQuote`, which never sets it) — relying on it the way the EVM
   * path relies on `quote.priceUsd` would mean Solana never gets a single realized-PnL row.
   * Instead, this uses the fact every Solana trade through Kamby is anchored to USDC on one
   * side by construction (`SOLANA_USDC_MINT` — see `SolanaQuoteService`'s own doc comment:
   * "BUY always spends this... SELL always produces this"): the USDC leg's own raw amount
   * *is* the USD figure directly (USDC ≈ $1/unit, 6 decimals, no price lookup needed at
   * all), and the non-USDC leg (`outputMint` for BUY, `inputMint` for SELL) is the tracked
   * lot token. This never has a "no price" skip case — every confirmed Solana trade always
   * has both legs' raw amounts on the row already.
   */
  private async processSolanaRow(row: SolanaSweepRow): Promise<void> {
    // Verified, not assumed: the "one leg is always USDC" invariant this whole method
    // leans on is a real, current fact about how SolanaQuoteService builds a quote today,
    // not a guarantee this codebase enforces at the type level — if a future change to
    // Solana trading ever allows a direct non-USDC-to-non-USDC swap, this must fail loudly
    // (skip, mark processed, log) rather than silently mispricing a trade off the wrong
    // leg's raw amount.
    const usdcLeg = row.side === 'BUY' ? row.inputMint : row.outputMint;
    if (usdcLeg !== SOLANA_USDC_MINT) {
      await prisma.solanaTradeTransaction.update({ where: { id: row.id }, data: { pnlProcessedAt: new Date() } });
      this.logger.error({ transactionId: row.id, side: row.side }, 'pnl sweep: skipped Solana transaction — neither leg is USDC, the guaranteed-anchor invariant this sweep relies on no longer holds');
      return;
    }
    const trackedMint = row.side === 'BUY' ? row.outputMint : row.inputMint;
    const confirmedAt = row.confirmedAt ?? new Date();

    await this.withUserTokenLock(row.userId, 'SOLANA', trackedMint, async (tx) => {
      if (row.side === 'BUY') {
        const usdSpent = rawToDecimal(row.inputAmount, USDC_DECIMALS);
        await tx.tokenLot.create({
          data: {
            userId: row.userId,
            chain: 'SOLANA',
            solanaMint: trackedMint,
            solanaBuyTransactionId: row.id,
            quantityOriginalRaw: row.expectedOutputAmount,
            quantityRemainingRaw: row.expectedOutputAmount,
            costBasisUsd: usdSpent,
            acquiredAt: confirmedAt,
          },
        });
      } else {
        const usdReceived = rawToDecimal(row.expectedOutputAmount, USDC_DECIMALS);
        await this.matchAndRecordSell(tx, {
          userId: row.userId,
          chain: 'SOLANA',
          evmTokenId: null,
          solanaMint: trackedMint,
          sellQuantityRaw: row.inputAmount,
          sellProceedsUsd: usdReceived,
          confirmedAt,
          evmSellTransactionId: null,
          solanaSellTransactionId: row.id,
        });
      }
      await tx.solanaTradeTransaction.update({ where: { id: row.id }, data: { pnlProcessedAt: new Date() } });
    });
  }

  /** Fetches this user's open lots for one `(chain, token)`, oldest-`acquiredAt`-first,
   *  FIFO-matches the sell against them via `@kamby/domain`'s pure matcher, and persists
   *  one `RealizedPnlEvent` per match plus the corresponding `quantityRemainingRaw`
   *  decrement on each consumed lot. Any unmatched excess (see `computeFifoRealizedPnl`'s
   *  own doc comment) is simply never written anywhere — not matched against nothing, not
   *  counted as profit. Takes `tx` explicitly rather than reading the module-level
   *  `prisma` — must run on the same transaction `withUserTokenLock` already opened, or
   *  the advisory lock guards nothing real. */
  private async matchAndRecordSell(
    tx: Tx,
    params: {
      userId: string;
      chain: 'EVM' | 'SOLANA';
      evmTokenId: string | null;
      solanaMint: string | null;
      sellQuantityRaw: string;
      sellProceedsUsd: number;
      confirmedAt: Date;
      evmSellTransactionId: string | null;
      solanaSellTransactionId: string | null;
    },
  ): Promise<void> {
    const openLotRows = await tx.tokenLot.findMany({
      where: {
        userId: params.userId,
        chain: params.chain,
        evmTokenId: params.evmTokenId,
        solanaMint: params.solanaMint,
        quantityRemainingRaw: { not: '0' },
      },
      orderBy: { acquiredAt: 'asc' },
    });
    const openLots: OpenLot[] = openLotRows.map((lot) => ({
      id: lot.id,
      quantityOriginalRaw: lot.quantityOriginalRaw,
      quantityRemainingRaw: lot.quantityRemainingRaw,
      costBasisUsd: Number(lot.costBasisUsd),
    }));

    const { matches } = computeFifoRealizedPnl(openLots, params.sellQuantityRaw, params.sellProceedsUsd);

    for (const match of matches) {
      const lot = openLotRows.find((l) => l.id === match.lotId)!;
      const newRemaining = BigInt(lot.quantityRemainingRaw) - BigInt(match.quantityMatchedRaw);
      await tx.tokenLot.update({ where: { id: lot.id }, data: { quantityRemainingRaw: newRemaining.toString() } });
      await tx.realizedPnlEvent.create({
        data: {
          userId: params.userId,
          chain: params.chain,
          evmTokenId: params.evmTokenId,
          solanaMint: params.solanaMint,
          lotId: match.lotId,
          evmSellTransactionId: params.evmSellTransactionId,
          solanaSellTransactionId: params.solanaSellTransactionId,
          quantityMatchedRaw: match.quantityMatchedRaw,
          costBasisUsd: match.costBasisUsd,
          proceedsUsd: match.proceedsUsd,
          realizedPnlUsd: match.realizedPnlUsd,
          confirmedAt: params.confirmedAt,
        },
      });
    }
  }

  /** Opens a Postgres advisory transaction lock scoped to `(userId, chain, token)`, then
   *  runs `fn` with the SAME transaction client the lock was acquired on — see this
   *  class's own doc comment for why this codebase's usual single-row-atomic-update
   *  pattern isn't enough here (correctness depends on reading several existing `TokenLot`
   *  rows before writing them back consistently). `pg_advisory_xact_lock`, not the
   *  session-scoped `pg_advisory_lock` — released automatically when the transaction ends,
   *  including on error, never needs an explicit unlock call. */
  private async withUserTokenLock<T>(userId: string, chain: 'EVM' | 'SOLANA', tokenKey: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const lockKey = `${userId}:${chain}:${tokenKey}`;
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return fn(tx);
    });
  }
}

interface EvmSweepRow {
  id: string;
  userId: string;
  side: string;
  expectedOutputAmount: string;
  inputAmount: string;
  confirmedAt: Date | null;
  quote: { priceUsd: unknown | null };
  tokenMarket: { tokenId: string; token: { decimals: number | null } };
}

interface SolanaSweepRow {
  id: string;
  userId: string;
  side: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  expectedOutputAmount: string;
  confirmedAt: Date | null;
}
