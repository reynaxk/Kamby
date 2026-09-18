export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens and starts short-circuiting calls. */
  failureThreshold: number;
  /** How long the breaker stays fully OPEN before allowing one probe call through. */
  resetTimeoutMs: number;
}

/**
 * A minimal, dependency-free circuit breaker: CLOSED (normal) -> OPEN (short-circuits every
 * call immediately, no network attempt at all) -> HALF_OPEN (lets exactly one probe call
 * through once `resetTimeoutMs` has passed) -> CLOSED again on that probe's success, or
 * back to OPEN immediately on its failure. Exists specifically so a rate-limited or down
 * RPC endpoint stops being hammered by every concurrent request while it's already known to
 * be failing — each call against a struggling endpoint would otherwise still cost a full
 * request timeout, multiplied by concurrent traffic, which is exactly the "429 cascade"
 * this is meant to prevent (see docs/TRADING.md#rpc-failover).
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  /** The externally-visible state, computing the OPEN -> HALF_OPEN time-based transition on
   *  read rather than via a timer — nothing needs to observe this except right before a
   *  call decides whether to proceed. */
  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.options.resetTimeoutMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  /** Runs `fn` only if the breaker isn't fully OPEN. Throws immediately, without ever
   *  calling `fn`, while OPEN — the entire point being to skip the network call, not just
   *  to catch its eventual failure. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === 'OPEN') {
      throw new Error('circuit breaker is open — refusing to call a known-failing endpoint');
    }
    if (currentState === 'HALF_OPEN') {
      // Commit the time-based transition so onSuccess/onFailure below observe it — a single
      // probe call is in flight now, and its outcome alone decides CLOSED vs. OPEN again.
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    // A HALF_OPEN probe failing reopens immediately, regardless of failureThreshold — it
    // already proved the endpoint is still bad, no need to collect more failures first.
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }
}
