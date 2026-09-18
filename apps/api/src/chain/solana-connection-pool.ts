import { Connection } from '@solana/web3.js';
import type { PinoLogger } from 'nestjs-pino';
import { CircuitBreaker } from './circuit-breaker';

export const SOLANA_CONNECTION_POOL = Symbol('SOLANA_CONNECTION_POOL');

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 15_000;

/**
 * Solana's counterpart to viem's built-in `fallback()` transport
 * (see @kamby/chain-adapters' createEvmTransport) — @solana/web3.js's `Connection` has no
 * equivalent multi-endpoint failover of its own, so this hand-rolls the same idea: a
 * primary Connection, an optional fallback Connection, and a circuit breaker per endpoint
 * so a failing primary stops being hit on every call (see docs/TRADING.md#rpc-failover).
 *
 * Deliberately operates at the "which Connection do I hand this operation" level rather
 * than trying to proxy or re-implement Connection's entire surface: `sendAndConfirmTransaction`
 * and every `Connection` method alike just take a real `Connection` instance, so
 * `withFailover` hands the caller a real one instead of a partial lookalike that would
 * break the moment something calls a method this class didn't think to forward.
 */
export class SolanaConnectionPool {
  private readonly primary: Connection;
  private readonly fallbackConnection: Connection | null;
  private readonly primaryBreaker = new CircuitBreaker({ failureThreshold: FAILURE_THRESHOLD, resetTimeoutMs: RESET_TIMEOUT_MS });
  private readonly fallbackBreaker = new CircuitBreaker({ failureThreshold: FAILURE_THRESHOLD, resetTimeoutMs: RESET_TIMEOUT_MS });

  constructor(
    rpcUrl: string,
    rpcUrlFallback: string | null,
    private readonly logger: PinoLogger,
  ) {
    this.primary = new Connection(rpcUrl, 'confirmed');
    this.fallbackConnection = rpcUrlFallback ? new Connection(rpcUrlFallback, 'confirmed') : null;
  }

  /**
   * Runs `operation` against the primary connection, gated by its circuit breaker; on
   * failure (a thrown error, or the breaker already open from recent failures), falls back
   * to the secondary connection if one is configured. Never silently swallows a failure —
   * if the fallback also fails (or none is configured), the error propagates to the caller
   * exactly as an unwrapped `Connection` call would have failed before this existed.
   */
  async withFailover<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    try {
      return await this.primaryBreaker.execute(() => operation(this.primary));
    } catch (primaryError) {
      if (!this.fallbackConnection) throw primaryError;
      this.logger.warn({ err: primaryError }, 'primary Solana RPC failed — retrying against fallback endpoint');
      try {
        return await this.fallbackBreaker.execute(() => operation(this.fallbackConnection!));
      } catch (fallbackError) {
        this.logger.error({ err: fallbackError }, 'fallback Solana RPC also failed');
        throw fallbackError;
      }
    }
  }
}
