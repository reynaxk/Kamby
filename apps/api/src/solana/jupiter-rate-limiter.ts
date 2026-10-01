/**
 * Keeps every Jupiter call this API process makes under the key's plan limit
 * (SOLANA_JUPITER_MAX_RPS — 1/s on the free plan; the user is buying a 10/s plan before
 * launch, 2026-10-01). Calls are spaced evenly rather than allowed to burst, so a rush of
 * Buy clicks queues for a moment instead of getting 429s from Jupiter. A call that would
 * have to wait longer than `maxWaitMs` fails fast instead — the user sees "busy, try again"
 * rather than a quote that hangs.
 */
export class JupiterRateLimiter {
  private nextSlotAt = 0;
  private readonly spacingMs: number;

  constructor(
    requestsPerSecond: number,
    private readonly maxWaitMs = 8_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.spacingMs = 1000 / Math.max(requestsPerSecond, 0.1);
  }

  /** Resolves when this call may go out; rejects with JupiterBusyError when the queue is too long. */
  async take(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlotAt);
    const waitMs = slot - now;
    if (waitMs > this.maxWaitMs) throw new JupiterBusyError(waitMs);
    this.nextSlotAt = slot + this.spacingMs;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  /** Counts a call that already waited (a 429 retry after Jupiter's own Retry-After), so
   *  the calls queued behind it stay spaced — without making the retry wait twice. */
  note(): void {
    this.nextSlotAt = Math.max(this.now(), this.nextSlotAt) + this.spacingMs;
  }
}

export class JupiterBusyError extends Error {
  constructor(readonly waitMs: number) {
    super(`Solana quotes are busy right now — try again in a few seconds (queue ${Math.round(waitMs / 1000)}s)`);
    this.name = 'JupiterBusyError';
  }
}
