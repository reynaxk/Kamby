import type { Connection } from '@solana/web3.js';
import { prisma } from '@kamby/db';
import { SOLANA_ACTIVITY_REALTIME_CHANNEL, TRADING_DEFAULTS } from '@kamby/domain';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Bounds one sweep tick's RPC work — same philosophy as TradeSweepService's own BATCH_SIZE
 *  and MarketIngestionService's MAX_BLOCKS_PER_TICK: a large backlog simply continues over
 *  several ticks. */
const BATCH_SIZE = 50;

export interface SolanaSweepResult {
  checked: number;
  confirmed: number;
  failed: number;
  expired: number;
}

/**
 * Solana's counterpart to TradeSweepService (./sweep.ts) — see
 * docs/TRADING.md#transaction-lifecycle. apps/api's
 * SolanaTransactionService#refreshStatus already refreshes a PENDING Solana transaction
 * on-demand whenever someone actively looks at it; this sweep is what resolves the ones
 * nobody is watching (a closed tab, a backgrounded trade) so PENDING doesn't linger
 * forever — the same role the EVM sweep already plays, now mirrored for Solana. Status
 * only ever moves in response to a real `getSignatureStatuses` result, or — EXPIRED —
 * after giving up on a bounded wait; never a fabricated confirmation.
 *
 * Deliberately does NOT re-verify the on-chain transaction's instructions against the
 * persisted quote before confirming, unlike the EVM sweep's `transactionMatchesQuote`
 * check — this mirrors, not diverges from, `SolanaTransactionService#refreshStatus`'s own
 * documented choice: a self-paid Solana trade is non-custodial with no separate
 * fee-transfer leg, so a mismatched signature here can only ever corrupt one user's own
 * trade history, never move money or affect anyone else. This applies to every row this
 * sweep processes, sponsored ones included: a sponsored row's actual on-chain transaction
 * is already verified to match its quote *before* the gas relayer ever broadcasts it (see
 * apps/api's `solana-quote-match.ts` and `GasRelayerService#submitSponsoredTransaction`),
 * so there's no mismatched-sponsored-transaction case for this sweep to ever encounter in
 * the first place. Same reasoning, same intentional gap, applied consistently to both the
 * on-demand and backstop confirmation paths rather than inventing a stricter rule for just
 * one of them.
 *
 * Also publishes the same Redis realtime ping `SolanaTransactionService` does on a fresh
 * CONFIRMED — a trade nobody was watching still needs to show up in the live activity feed
 * once this sweep catches it, not just when the original tab happened to be open.
 */
export class SolanaSweepService {
  constructor(
    private readonly connection: Connection,
    private readonly fallbackConnection: Connection | null,
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async sweepPendingTransactions(): Promise<SolanaSweepResult> {
    const pending = await prisma.solanaTradeTransaction.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      take: BATCH_SIZE,
    });

    const result: SolanaSweepResult = { checked: 0, confirmed: 0, failed: 0, expired: 0 };
    for (const row of pending) {
      result.checked += 1;
      try {
        const { value } = await this.getSignatureStatuses(row.signature);
        const status = value[0];

        if (!status) {
          const ageMinutes = (Date.now() - row.submittedAt.getTime()) / 60_000;
          if (ageMinutes > TRADING_DEFAULTS.pendingTransactionTimeoutMinutes) {
            await prisma.solanaTradeTransaction.update({
              where: { id: row.id },
              data: { status: 'EXPIRED', failureReason: 'No confirmation received within the expected time' },
            });
            result.expired += 1;
          }
          // Otherwise: not yet visible to this RPC and not stale — left PENDING, tried again next tick.
          continue;
        }

        if (status.err) {
          await prisma.solanaTradeTransaction.update({
            where: { id: row.id },
            data: { status: 'FAILED', failureReason: 'Transaction failed on-chain' },
          });
          result.failed += 1;
          continue;
        }

        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          await prisma.solanaTradeTransaction.update({
            where: { id: row.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
          await this.publishConfirmed(row.id);
          result.confirmed += 1;
        }
        // Otherwise: seen but not yet confirmed/finalized — left PENDING, tried again next tick.
      } catch (error) {
        // One bad row (a transient RPC hiccup) never aborts the rest of the batch.
        this.logger.error({ err: error, transactionId: row.id }, 'solana sweep: failed to refresh one transaction — will retry next tick');
      }
    }
    return result;
  }

  /**
   * Tries the primary connection, falling back to the secondary (if configured) on any
   * failure. Deliberately a lighter-weight retry than apps/api's `SolanaConnectionPool`
   * circuit breaker: that exists to stop a user-facing request path from hammering a
   * struggling endpoint under concurrent traffic, a load profile this periodic batch job
   * doesn't share — one attempt per pending row per tick, not concurrent user quotes — so
   * there's no cascading-429 risk here to guard against with persistent breaker state.
   */
  private async getSignatureStatuses(signature: string): ReturnType<Connection['getSignatureStatuses']> {
    try {
      return await this.connection.getSignatureStatuses([signature]);
    } catch (error) {
      if (!this.fallbackConnection) throw error;
      this.logger.warn({ err: error }, 'solana sweep: primary RPC failed — retrying against fallback endpoint');
      return this.fallbackConnection.getSignatureStatuses([signature]);
    }
  }

  /** Bare ping, same "never the activity itself" contract as apps/api's own publish and
   *  the EVM ingestion worker's — a publish failure only delays a live viewer seeing it;
   *  the row is already persisted CONFIRMED above regardless, and the global feed will show
   *  it on the next fetch/reconnect either way. */
  private async publishConfirmed(transactionId: string): Promise<void> {
    try {
      await this.redis.publish(SOLANA_ACTIVITY_REALTIME_CHANNEL, JSON.stringify({ transactionId, atIso: new Date().toISOString() }));
    } catch (error) {
      this.logger.warn({ err: error, transactionId }, 'solana sweep: failed to publish realtime confirmation ping');
    }
  }
}
