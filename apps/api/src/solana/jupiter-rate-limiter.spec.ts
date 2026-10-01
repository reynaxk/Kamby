import { JupiterBusyError, JupiterRateLimiter } from './jupiter-rate-limiter';

describe('JupiterRateLimiter', () => {
  it('spaces calls evenly at the plan limit instead of letting them burst', async () => {
    let now = 0;
    const limiter = new JupiterRateLimiter(10, 8_000, () => now);
    const waits: number[] = [];
    jest.useFakeTimers();
    const calls = Array.from({ length: 5 }, () => {
      const start = now;
      return limiter.take().then(() => waits.push(now - start));
    });
    for (let i = 0; i < 5; i++) {
      now += 100;
      await jest.advanceTimersByTimeAsync(100);
    }
    await Promise.all(calls);
    jest.useRealTimers();
    expect(waits).toHaveLength(5);
    // 10/s = one call every 100ms: the 5th waited ~400ms, not 0.
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(400);
  });

  it('fails fast with a "busy" error once the queue would wait longer than allowed', async () => {
    const now = 0;
    const limiter = new JupiterRateLimiter(1, 2_500, () => now);
    void limiter.take(); // slot 0
    void limiter.take(); // waits 1s
    void limiter.take(); // waits 2s
    await expect(limiter.take()).rejects.toBeInstanceOf(JupiterBusyError); // would wait 3s
  });
});
