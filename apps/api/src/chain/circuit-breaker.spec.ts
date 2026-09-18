import { CircuitBreaker } from './circuit-breaker';

function breaker(overrides: Partial<{ failureThreshold: number; resetTimeoutMs: number }> = {}): CircuitBreaker {
  return new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, ...overrides });
}

describe('CircuitBreaker', () => {
  it('starts CLOSED and lets calls through normally', async () => {
    const cb = breaker();
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('stays CLOSED and resets the failure count after any success', async () => {
    const cb = breaker({ failureThreshold: 3 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.resolve('ok'))).resolves.toBe('ok');

    // Two more failures after the reset shouldn't be enough to open a threshold-3 breaker.
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after reaching the failure threshold', async () => {
    const cb = breaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('short-circuits without ever calling fn while OPEN', async () => {
    const cb = breaker({ failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    const fn = jest.fn().mockResolvedValue('should not run');
    await expect(cb.execute(fn)).rejects.toThrow(/circuit breaker is open/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('moves to HALF_OPEN and allows one probe call after resetTimeoutMs elapses', async () => {
    const cb = breaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cb.getState()).toBe('HALF_OPEN');

    const probe = jest.fn().mockResolvedValue('recovered');
    await expect(cb.execute(probe)).resolves.toBe('recovered');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('reopens immediately if the HALF_OPEN probe itself fails, without needing failureThreshold more failures', async () => {
    const cb = breaker({ failureThreshold: 5, resetTimeoutMs: 50 });
    await expect(cb.execute(() => Promise.reject(new Error('fail 1')))).rejects.toThrow();
    // Only 1 of 5 failures so far — still CLOSED, not OPEN yet.
    expect(cb.getState()).toBe('CLOSED');

    // Force it open via a run of failures, then let it cool down to HALF_OPEN.
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    }
    expect(cb.getState()).toBe('OPEN');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cb.getState()).toBe('HALF_OPEN');

    await expect(cb.execute(() => Promise.reject(new Error('probe still failing')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
  });
});
