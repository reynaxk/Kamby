import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import { Prisma, prisma } from '@kamby/db';
import type { TradeSide, TradeStatus } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';

export interface SolanaTradeTransactionDto {
  id: string;
  signature: string;
  side: TradeSide;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  expectedOutputAmount: string;
  platformFeeAmount: string;
  status: TradeStatus;
  failureReason: string | null;
  submittedAt: string;
  confirmedAt: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Solana's counterpart to TransactionService — records a signature the wallet has already
 * broadcast, and refreshes its status against a real on-chain confirmation, never a
 * client's say-so.
 *
 * Deliberately lighter than TransactionService's EVM flow in one specific way: this does
 * NOT decode and match the on-chain transaction's instructions against the persisted
 * quote (the EVM flow's `transactionMatchesQuote`). That check exists on the EVM side to
 * prevent an unrelated-but-successful hash from being credited as CONFIRMED — a real
 * concern there because a mismatched CONFIRMED status could feed the guaranteed-USDC-fee
 * accounting. The launch-scope Solana flow is non-custodial with no separate fee-transfer
 * step (Jupiter's platformFeeBps/feeAccount deduct atomically inside the swap) and no
 * backend custody at all — a mismatched signature here can only ever corrupt one user's
 * own trade history, never move money or affect anyone else. Full instruction-level
 * matching is real, worthwhile defense-in-depth to add before the (deferred) gasless
 * relayer ships, where the stakes are categorically different — see
 * docs/WALLET_SECURITY.md's Solana section — but isn't the launch-blocking bar here.
 */
@Injectable()
export class SolanaTransactionService {
  private readonly connection: Connection | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.connection = solanaConfig ? new Connection(solanaConfig.rpcUrl, 'confirmed') : null;
    this.logger.setContext('SolanaTransactionService');
  }

  private requireConnection(): Connection {
    if (!this.connection) throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    return this.connection;
  }

  /**
   * Records a transaction the wallet has already signed and broadcast. Idempotent on
   * `signature` (unique) and on `quoteId` (unique) — a client retry returns the existing
   * row instead of erroring or creating a duplicate, same contract as
   * TransactionService#submitTransaction.
   */
  async submitTransaction(params: { userId: string; walletAddress: string; quoteId: string; signature: string }): Promise<SolanaTradeTransactionDto> {
    const existingByQuote = await prisma.solanaTradeTransaction.findUnique({ where: { quoteId: params.quoteId } });
    if (existingByQuote) {
      if (existingByQuote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
      return toDto(existingByQuote);
    }

    const quote = await prisma.solanaTradeQuote.findUnique({ where: { id: params.quoteId } });
    if (!quote) throw new NotFoundException(`No quote "${params.quoteId}"`);
    if (quote.userId !== params.userId) throw new ForbiddenException('This quote does not belong to you');
    if (quote.walletAddress !== params.walletAddress) {
      throw new ForbiddenException('This quote was created for a different wallet');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException('This quote has expired — request a new one before submitting');
    }

    const wallet = await prisma.wallet.findUnique({ where: { address: params.walletAddress } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null || wallet.chain !== 'SOLANA') {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }

    try {
      const created = await prisma.solanaTradeTransaction.create({
        data: {
          userId: params.userId,
          walletAddress: params.walletAddress,
          quoteId: quote.id,
          signature: params.signature,
          side: quote.side,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          inputAmount: quote.inputAmount,
          expectedOutputAmount: quote.expectedOutputAmount,
          platformFeeAmount: quote.platformFeeAmount,
        },
      });
      this.logger.info({ transactionId: created.id, signature: params.signature }, 'solana trade submitted');
      return toDto(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.solanaTradeTransaction.findUnique({ where: { signature: params.signature } });
        if (existing) {
          if (existing.userId !== params.userId) throw new ForbiddenException('This transaction does not belong to you');
          return toDto(existing);
        }
      }
      throw error;
    }
  }

  async getTransaction(userId: string, id: string): Promise<SolanaTradeTransactionDto> {
    const row = await prisma.solanaTradeTransaction.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException(`No transaction "${id}"`);

    const refreshed = row.status === 'PENDING' ? await this.refreshStatus(row) : row;
    return toDto(refreshed);
  }

  async getHistory(userId: string, cursor: string | undefined, limit: number): Promise<CursorPage<SolanaTradeTransactionDto>> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const rows = await prisma.solanaTradeTransaction.findMany({
      where: {
        userId,
        ...(decoded
          ? { OR: [{ createdAt: { lt: new Date(decoded.createdAt) } }, { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

    return { items: page.map(toDto), nextCursor };
  }

  private async refreshStatus(row: SolanaTradeTransactionRow): Promise<SolanaTradeTransactionRow> {
    const connection = this.requireConnection();
    const { value } = await connection.getSignatureStatuses([row.signature]);
    const status = value[0];

    if (!status) {
      // Not yet visible to this RPC — same "can't decide yet, leave PENDING" contract as
      // the EVM flow's not-found case.
      return row;
    }
    if (status.err) {
      this.logger.warn({ transactionId: row.id, signature: row.signature, err: status.err }, 'solana transaction failed on-chain');
      return prisma.solanaTradeTransaction.update({
        where: { id: row.id },
        data: { status: 'FAILED', failureReason: 'Transaction failed on-chain' },
      });
    }
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      return prisma.solanaTradeTransaction.update({
        where: { id: row.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
    }
    return row;
  }
}

type SolanaTradeTransactionRow = Awaited<ReturnType<typeof prisma.solanaTradeTransaction.findUniqueOrThrow>>;

function toDto(row: SolanaTradeTransactionRow): SolanaTradeTransactionDto {
  return {
    id: row.id,
    signature: row.signature,
    side: row.side as TradeSide,
    inputMint: row.inputMint,
    outputMint: row.outputMint,
    inputAmount: row.inputAmount,
    expectedOutputAmount: row.expectedOutputAmount,
    platformFeeAmount: row.platformFeeAmount,
    status: row.status,
    failureReason: row.failureReason,
    submittedAt: row.submittedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
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
