import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvmChainDataProvider } from '@kamby/chain-adapters';
import { Prisma, prisma } from '@kamby/db';
import { normalizeEvmAddress, parseUnsignedTx, TRADING_DEFAULTS, transactionMatchesQuote, type TradeTransactionDto } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getConfiguredChains, type Env } from '../config/env';
import { EvmGasRelayerQuoteService } from './relayer/evm-gas-relayer-quote.service';
import { TRANSACTION_INCLUDE, toDto, type TransactionRow } from './transaction-dto';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Owns the transaction lifecycle from "the wallet broadcast something" onward — see
 * docs/TRADING.md#transaction-lifecycle. Never marks a trade CONFIRMED from a client's
 * say-so: the only path to CONFIRMED/FAILED is a real on-chain receipt, checked here
 * on-demand (`getTransaction`) and by apps/workers' background sweep for anyone not
 * actively watching. Critically, a successful receipt alone is never sufficient either — a
 * receipt only proves *some* transaction with this hash succeeded, not that it's the trade
 * a quote actually described. See docs/TRADING.md#transaction-integrity: every CONFIRMED
 * transition re-verifies the transaction's real sender, destination, value, and calldata
 * against the persisted quote first.
 */
@Injectable()
export class TransactionService {
  /** One reader per configured chain, built once at construction — never per-request, which
   *  would defeat each reader's own connection reuse. A `TradeTransaction`/`TradeQuote`
   *  row's `chainId` is a persisted fact, not a request-time guess, so every lookup below is
   *  keyed off the row's own column, never a service-level default. */
  private readonly chainReaders: Map<number, EvmChainDataProvider>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
    private readonly gasRelayer: EvmGasRelayerQuoteService,
  ) {
    this.chainReaders = new Map(
      getConfiguredChains((key) => config.get(key, { infer: true })).map((chain) => [
        chain.chainId,
        new EvmChainDataProvider({
          chain: { identifier: `eip155:${chain.chainId}`, name: chain.slug, nativeSymbol: 'ETH' },
          rpcUrl: chain.rpcUrl,
          rpcUrlFallback: chain.rpcUrlFallback,
        }),
      ]),
    );
    this.logger.setContext('TransactionService');
  }

  /** Never a silent fallback to another chain's reader — see docs/TRADING.md#chain-scope
   *  for why a lookup miss here would otherwise be the most dangerous class of bug in this
   *  file: `getTransactionDetails` treats "wrong RPC for this hash's chain" identically to
   *  "not found yet," so a misrouted reader fails silently (looks like an unconfirmed
   *  transaction) rather than loudly. */
  private resolveReader(chainId: number): EvmChainDataProvider {
    const reader = this.chainReaders.get(chainId);
    if (!reader) {
      this.logger.error({ chainId }, 'no chain reader configured for this chainId');
      throw new UnprocessableEntityException(`Chain ${chainId} is not configured on this deployment`);
    }
    return reader;
  }

  /**
   * Records a transaction the wallet has already signed and broadcast. Idempotent on
   * `(chainId, txHash)` and on `quoteId` (both unique) — a client retry (e.g. a flaky
   * response the first time) returns the existing row instead of erroring or creating a
   * duplicate. See docs/TRADING.md#idempotency.
   *
   * Security — see docs/TRADING.md#transaction-integrity and #authorization. Every one of
   * these is a real, previously-found gap this method now closes, not a hypothetical:
   *  1. Quote freshness is re-checked here, not just in the client — a stale quoteId can
   *     never be replayed against a later, unrelated transaction.
   *  2. Wallet ownership is re-derived from the database, not trusted from the quote's
   *     frozen snapshot — a wallet unlinked (or re-verified to a different account) after
   *     the quote was created can no longer be used to submit against it.
   *  3. If the transaction is already visible on-chain, its real sender/destination/value/
   *     calldata are checked against the quote *before* a row is ever created — an
   *     unrelated (even if genuinely successful) hash is rejected outright, not silently
   *     accepted and left for `refreshStatus` to eventually mis-confirm.
   */
  async submitTransaction(params: { userId: string; walletAddress: string; quoteId: string; txHash: string }): Promise<TradeTransactionDto> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(params.txHash)) {
      throw new UnprocessableEntityException('txHash must be a well-formed 32-byte transaction hash');
    }
    const walletAddress = normalizeEvmAddress(params.walletAddress);

    const existingByQuote = await prisma.tradeTransaction.findUnique({
      where: { quoteId: params.quoteId },
      include: TRANSACTION_INCLUDE,
    });
    if (existingByQuote) {
      if (existingByQuote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
      return toDto(existingByQuote);
    }

    const quote = await prisma.tradeQuote.findUnique({ where: { id: params.quoteId } });
    if (!quote) throw new NotFoundException(`No quote "${params.quoteId}"`);
    if (quote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
    if (normalizeEvmAddress(quote.walletAddress) !== walletAddress) {
      throw new ForbiddenException('This quote was created for a different wallet');
    }

    // Quote freshness — see docs/TRADING.md#quote-expiration. A submission against an
    // expired quoteId is rejected here, not just checked client-side: this closes the
    // specific replay this gate exists for — reusing an old, stale quoteId to attach a
    // later, unrelated transaction hash to a trade Kamby never actually reviewed at that
    // price. It does not (and structurally cannot) undo a transaction the wallet already
    // broadcast; it only refuses to let Kamby's own records treat that broadcast as the
    // reviewed trade.
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException('This quote has expired — request a new one before submitting');
    }

    // Wallet ownership can change after a quote is created — a wallet can be unlinked, or
    // re-verified to a different account (see docs/TRADING.md#wallet-ownership) — so it's
    // re-derived from the database now rather than trusted from the quote's frozen
    // snapshot at creation time.
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }

    const expectedUnsignedTx = parseUnsignedTx(quote.unsignedTx);
    if (!expectedUnsignedTx) {
      // Only possible for a corrupted row — this codebase is the only writer of
      // unsignedTx — but a transaction-integrity check must never proceed from an
      // assumption it hasn't actually verified.
      this.logger.error({ quoteId: quote.id }, 'quote has an unparseable unsignedTx — refusing to accept a submission against it');
      throw new UnprocessableEntityException('This quote can no longer be submitted — request a new one');
    }

    // Best-effort, fail-fast check: if the transaction is already visible to our RPC
    // (mined, or already propagated to this node's mempool), verify it's actually the
    // transaction that was quoted — real sender, destination, value, and calldata, all
    // exactly matching — before ever creating a row for it. An arbitrary or unrelated hash
    // is rejected right here, with a clear reason, rather than silently accepted. If it
    // isn't visible yet (a very recent broadcast that hasn't propagated to this RPC), this
    // can't be decided from here — that's fine: `refreshStatus` below is the authoritative,
    // race-free gate (it only runs this same check once the transaction is actually mined)
    // and never marks CONFIRMED without it passing.
    const onChain = await this.resolveReader(quote.chainId).getTransactionDetails(params.txHash);
    if (onChain && !transactionMatchesQuote(onChain, { walletAddress, unsignedTx: expectedUnsignedTx })) {
      this.logger.warn({ quoteId: quote.id, txHash: params.txHash }, 'submitted transaction does not match the reviewed quote');
      throw new ForbiddenException('This transaction does not match the trade you reviewed');
    }

    try {
      const created = await prisma.tradeTransaction.create({
        data: {
          userId: params.userId,
          walletAddress,
          quoteId: quote.id,
          chainId: quote.chainId,
          txHash: params.txHash,
          tokenMarketId: quote.tokenMarketId,
          side: quote.side,
          inputToken: quote.inputToken,
          outputToken: quote.outputToken,
          inputAmount: quote.inputAmount,
          expectedOutputAmount: quote.expectedOutputAmount,
          platformFeeAmount: quote.platformFeeAmount,
        },
        include: TRANSACTION_INCLUDE,
      });
      this.logger.info({ transactionId: created.id, txHash: params.txHash }, 'trade submitted');
      return toDto(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Same (chainId, txHash) already recorded — a retry, not a new trade.
        const existing = await prisma.tradeTransaction.findUnique({
          where: { chainId_txHash: { chainId: quote.chainId, txHash: params.txHash } },
          include: TRANSACTION_INCLUDE,
        });
        if (existing) {
          if (existing.userId !== params.userId) throw new ForbiddenException('This transaction does not belong to you');
          return toDto(existing);
        }
      }
      throw error;
    }
  }

  /**
   * Records the separate USDC fee-transfer transaction alongside an already-submitted
   * trade — see docs/TRADING.md#guaranteed-usdc-fees. Mirrors `submitTransaction`'s
   * verification exactly (ownership re-checked from the database, real on-chain sender/
   * destination/value/calldata checked against the quote's `feeUnsignedTx` before ever
   * being accepted), just against the fee leg instead of the swap.
   */
  async submitFeeTransaction(params: { userId: string; transactionId: string; txHash: string }): Promise<TradeTransactionDto> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(params.txHash)) {
      throw new UnprocessableEntityException('txHash must be a well-formed 32-byte transaction hash');
    }

    const row = await prisma.tradeTransaction.findUnique({ where: { id: params.transactionId }, include: TRANSACTION_INCLUDE });
    if (!row || row.userId !== params.userId) throw new NotFoundException(`No transaction "${params.transactionId}"`);

    // Idempotent on an identical retry — same shape as submitTransaction's own idempotency.
    if (row.feeTxHash) {
      if (row.feeTxHash !== params.txHash) {
        throw new ForbiddenException('A different fee transfer has already been recorded for this trade');
      }
      return toDto(row);
    }

    const expectedFeeUnsignedTx = parseUnsignedTx(row.quote.feeUnsignedTx);
    if (!expectedFeeUnsignedTx) {
      throw new UnprocessableEntityException('This trade does not have a guaranteed-USDC fee transfer to submit');
    }

    // Wallet ownership can change after the trade was submitted — re-derived from the
    // database now rather than trusted from the row's frozen snapshot, same reasoning as
    // submitTransaction above.
    const wallet = await prisma.wallet.findUnique({ where: { address: row.walletAddress } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }

    const onChain = await this.resolveReader(row.chainId).getTransactionDetails(params.txHash);
    if (onChain && !transactionMatchesQuote(onChain, { walletAddress: row.walletAddress, unsignedTx: expectedFeeUnsignedTx })) {
      this.logger.warn({ transactionId: row.id, txHash: params.txHash }, 'submitted fee transaction does not match the expected transfer');
      throw new ForbiddenException('This transaction does not match the expected fee transfer');
    }

    try {
      const updated = await prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { feeTxHash: params.txHash, feeStatus: 'PENDING', feeSubmittedAt: new Date() },
        include: TRANSACTION_INCLUDE,
      });
      this.logger.info({ transactionId: row.id, feeTxHash: params.txHash }, 'fee transfer submitted');
      return toDto(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Same (chainId, feeTxHash) already recorded — against a *different* row, since
        // this row's own feeTxHash was confirmed null above. Rejected as a real conflict,
        // not silently returned as if it were this trade's own fee transfer.
        throw new ForbiddenException('This transaction hash is already recorded against a different trade');
      }
      throw error;
    }
  }

  /** Refreshes a still-PENDING transaction's status against a live receipt before
   *  returning it, so a user actively watching a trade sees it confirm promptly rather
   *  than waiting for the worker's next background sweep. Does the same for the separate
   *  fee transfer, independently — see docs/TRADING.md#guaranteed-usdc-fees. For a
   *  sponsored (relayer-paid) trade whose swap has just been observed CONFIRMED, this is
   *  also the one place that triggers the fee leg's own broadcast — see
   *  `EvmGasRelayerQuoteService#submitFeeLegIfDue`'s own doc comment for why it must run
   *  here (the same process that owns the relayer's nonce manager) rather than from
   *  apps/workers' background sweep. A no-op for every non-sponsored trade. */
  async getTransaction(userId: string, id: string): Promise<TradeTransactionDto> {
    const row = await prisma.tradeTransaction.findUnique({ where: { id }, include: TRANSACTION_INCLUDE });
    if (!row || row.userId !== userId) throw new NotFoundException(`No transaction "${id}"`);

    const afterStatus = row.status === 'PENDING' ? await this.refreshStatus(row) : row;
    if (afterStatus.status === 'CONFIRMED') {
      await this.gasRelayer.submitFeeLegIfDue(afterStatus);
    }
    const afterFeeStatus = afterStatus.feeStatus === 'PENDING' ? await this.refreshFeeStatus(afterStatus) : afterStatus;
    return toDto(afterFeeStatus);
  }

  async getHistory(userId: string, cursor: string | undefined, limit: number): Promise<CursorPage<TradeTransactionDto>> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const rows = await prisma.tradeTransaction.findMany({
      where: {
        userId,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: TRANSACTION_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map(toDto), nextCursor };
  }

  /**
   * Shared by the on-demand check above and apps/workers' background sweep — the only two
   * places a status is ever written. A successful receipt is necessary but never
   * sufficient for CONFIRMED — see docs/TRADING.md#transaction-integrity: the receipt only
   * proves *some* transaction with this hash succeeded, never that it's the specific trade
   * the persisted quote described. `row.quote.unsignedTx` (the exact thing the user was
   * shown and asked to sign) is what CONFIRMED is actually checked against.
   */
  async refreshStatus(row: TransactionRow): Promise<TransactionRow> {
    const reader = this.resolveReader(row.chainId);
    const receiptStatus = await reader.getTransactionReceiptStatus(row.txHash);
    if (receiptStatus === 'success') {
      const expectedUnsignedTx = parseUnsignedTx(row.quote.unsignedTx);
      const onChain = expectedUnsignedTx ? await reader.getTransactionDetails(row.txHash) : null;
      const matches =
        expectedUnsignedTx !== null &&
        onChain !== null &&
        transactionMatchesQuote(onChain, { walletAddress: row.walletAddress, unsignedTx: expectedUnsignedTx });

      if (!matches) {
        // A mined, successful receipt that doesn't match what was quoted is never left
        // PENDING (that would keep re-checking forever) and never CONFIRMED (that would be
        // exactly the fabrication this check exists to prevent) — it's a definite, terminal
        // mismatch.
        this.logger.error(
          { transactionId: row.id, txHash: row.txHash },
          'receipt succeeded but the on-chain transaction does not match the persisted quote — marking FAILED, not CONFIRMED',
        );
        return prisma.tradeTransaction.update({
          where: { id: row.id },
          data: { status: 'FAILED', failureReason: 'On-chain transaction does not match the reviewed trade' },
          include: TRANSACTION_INCLUDE,
        });
      }

      // A matching, successful receipt is still not enough on its own — see
      // TRADING_DEFAULTS.minConfirmations. A too-shallow (or unreadable) depth leaves the
      // row PENDING, never CONFIRMED and never FAILED: the receipt could still be correct,
      // it just hasn't settled enough yet, so the next check (on-demand or the next sweep
      // tick) tries again rather than this call blocking on it.
      const confirmations = await reader.getConfirmationCount(row.txHash);
      if (confirmations === null || confirmations < TRADING_DEFAULTS.minConfirmations) {
        this.logger.info(
          { transactionId: row.id, txHash: row.txHash, confirmations },
          'receipt matches but has not reached minConfirmations yet — leaving PENDING',
        );
        return row;
      }

      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
        include: TRANSACTION_INCLUDE,
      });
    }
    if (receiptStatus === 'reverted') {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'FAILED', failureReason: 'Transaction reverted on-chain' },
        include: TRANSACTION_INCLUDE,
      });
    }

    const ageMinutes = (Date.now() - row.submittedAt.getTime()) / 60_000;
    if (ageMinutes > TRADING_DEFAULTS.pendingTransactionTimeoutMinutes) {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { status: 'EXPIRED', failureReason: 'No confirmation received within the expected time' },
        include: TRANSACTION_INCLUDE,
      });
    }
    return row;
  }

  /**
   * The fee-leg twin of `refreshStatus` above — same integrity gate (a receipt alone is
   * never enough; the real on-chain sender/destination/value/calldata must match the
   * quote's `feeUnsignedTx`), same `minConfirmations` gate, same eventual `EXPIRED` after
   * `pendingTransactionTimeoutMinutes` of no receipt. Deliberately independent of the
   * swap's own `status`/`submittedAt` — a trade whose swap already confirmed stays a fully
   * successful trade for the user regardless of what happens to its fee transfer. A row
   * with no `feeTxHash` yet (fee not eligible, or eligible but not yet submitted) is
   * returned unchanged — never guessed at.
   */
  async refreshFeeStatus(row: TransactionRow): Promise<TransactionRow> {
    if (!row.feeTxHash || !row.feeSubmittedAt) return row;

    const expectedFeeUnsignedTx = parseUnsignedTx(row.quote.feeUnsignedTx);
    if (!expectedFeeUnsignedTx) {
      // Only possible for a corrupted row — this codebase is the only writer — but the
      // same rule as everywhere else: never proceed on an assumption not actually verified.
      this.logger.error({ transactionId: row.id }, 'fee transaction has no parseable feeUnsignedTx to verify against');
      return row;
    }

    const reader = this.resolveReader(row.chainId);
    const receiptStatus = await reader.getTransactionReceiptStatus(row.feeTxHash);
    if (receiptStatus === 'success') {
      const onChain = await reader.getTransactionDetails(row.feeTxHash);
      const matches =
        onChain !== null &&
        transactionMatchesQuote(onChain, { walletAddress: row.walletAddress, unsignedTx: expectedFeeUnsignedTx });

      if (!matches) {
        this.logger.error(
          { transactionId: row.id, feeTxHash: row.feeTxHash },
          'fee receipt succeeded but the on-chain transaction does not match the expected transfer — marking FAILED, not CONFIRMED',
        );
        return prisma.tradeTransaction.update({
          where: { id: row.id },
          data: { feeStatus: 'FAILED', feeFailureReason: 'On-chain transaction does not match the expected fee transfer' },
          include: TRANSACTION_INCLUDE,
        });
      }

      const confirmations = await reader.getConfirmationCount(row.feeTxHash);
      if (confirmations === null || confirmations < TRADING_DEFAULTS.minConfirmations) {
        return row;
      }

      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { feeStatus: 'CONFIRMED', feeConfirmedAt: new Date() },
        include: TRANSACTION_INCLUDE,
      });
    }
    if (receiptStatus === 'reverted') {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { feeStatus: 'FAILED', feeFailureReason: 'Fee transfer reverted on-chain' },
        include: TRANSACTION_INCLUDE,
      });
    }

    const ageMinutes = (Date.now() - row.feeSubmittedAt.getTime()) / 60_000;
    if (ageMinutes > TRADING_DEFAULTS.pendingTransactionTimeoutMinutes) {
      return prisma.tradeTransaction.update({
        where: { id: row.id },
        data: { feeStatus: 'EXPIRED', feeFailureReason: 'No confirmation received within the expected time' },
        include: TRANSACTION_INCLUDE,
      });
    }
    return row;
  }
}

interface HistoryCursor {
  createdAt: string;
  id: string;
}
function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeCursor(raw: string): HistoryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<HistoryCursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
