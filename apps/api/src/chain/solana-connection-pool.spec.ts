import type { PinoLogger } from 'nestjs-pino';
import { SolanaConnectionPool } from './solana-connection-pool';

const PRIMARY_URL = 'https://primary.example.com';
const FALLBACK_URL = 'https://fallback.example.com';

const connectionFns = new Map<string, jest.Mock>();

jest.mock('@solana/web3.js', () => ({
  // Every test controls behavior by setting connectionFns.get(url) before constructing the
  // pool — a Proxy so any method the operation under test calls (`.probe()`, `.getBalance()`,
  // `.getSignatureStatuses()`, ...) forwards to that URL's own configured jest.fn().
  Connection: jest.fn().mockImplementation(
    (url: string) =>
      new Proxy(
        {},
        {
          get: (_target, prop) => (...args: unknown[]) => connectionFns.get(url)?.(String(prop), ...args),
        },
      ),
  ),
}));

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

beforeEach(() => {
  connectionFns.clear();
  jest.clearAllMocks();
});

describe('SolanaConnectionPool', () => {
  it('calls the primary connection and returns its result when it succeeds', async () => {
    connectionFns.set(PRIMARY_URL, jest.fn().mockResolvedValue('primary-result'));
    const pool = new SolanaConnectionPool(PRIMARY_URL, null, fakeLogger());

    const result = await pool.withFailover((connection) => (connection as unknown as { probe(): Promise<string> }).probe());

    expect(result).toBe('primary-result');
  });

  it('falls over to the fallback connection when the primary fails', async () => {
    connectionFns.set(PRIMARY_URL, jest.fn().mockRejectedValue(new Error('primary down')));
    connectionFns.set(FALLBACK_URL, jest.fn().mockResolvedValue('fallback-result'));
    const pool = new SolanaConnectionPool(PRIMARY_URL, FALLBACK_URL, fakeLogger());

    const result = await pool.withFailover((connection) => (connection as unknown as { probe(): Promise<string> }).probe());

    expect(result).toBe('fallback-result');
  });

  it('propagates the primary error when no fallback is configured', async () => {
    connectionFns.set(PRIMARY_URL, jest.fn().mockRejectedValue(new Error('primary down, no fallback configured')));
    const pool = new SolanaConnectionPool(PRIMARY_URL, null, fakeLogger());

    await expect(
      pool.withFailover((connection) => (connection as unknown as { probe(): Promise<string> }).probe()),
    ).rejects.toThrow('primary down, no fallback configured');
  });

  it('propagates the fallback error (not the primary one) when both fail', async () => {
    connectionFns.set(PRIMARY_URL, jest.fn().mockRejectedValue(new Error('primary down')));
    connectionFns.set(FALLBACK_URL, jest.fn().mockRejectedValue(new Error('fallback also down')));
    const pool = new SolanaConnectionPool(PRIMARY_URL, FALLBACK_URL, fakeLogger());

    await expect(
      pool.withFailover((connection) => (connection as unknown as { probe(): Promise<string> }).probe()),
    ).rejects.toThrow('fallback also down');
  });

  it('stops even attempting the primary once its circuit breaker opens, going straight to fallback', async () => {
    const primaryFn = jest.fn().mockRejectedValue(new Error('primary down'));
    connectionFns.set(PRIMARY_URL, primaryFn);
    connectionFns.set(FALLBACK_URL, jest.fn().mockResolvedValue('fallback-result'));
    const pool = new SolanaConnectionPool(PRIMARY_URL, FALLBACK_URL, fakeLogger());
    const probe = (connection: unknown) => (connection as { probe(): Promise<string> }).probe();

    // The pool's internal failure threshold is 3 — after 3 failed attempts the breaker
    // opens, and a 4th call should skip the primary's network call entirely.
    for (let i = 0; i < 3; i++) {
      await expect(pool.withFailover(probe)).resolves.toBe('fallback-result');
    }
    expect(primaryFn).toHaveBeenCalledTimes(3);

    await expect(pool.withFailover(probe)).resolves.toBe('fallback-result');
    expect(primaryFn).toHaveBeenCalledTimes(3); // unchanged — the breaker short-circuited it
  });

  it('each operation is independent — a failed balance check does not poison a later signature-status check', async () => {
    connectionFns.set(
      PRIMARY_URL,
      jest.fn().mockImplementation((method: string) => (method === 'getBalance' ? Promise.reject(new Error('nope')) : Promise.resolve('ok'))),
    );
    const pool = new SolanaConnectionPool(PRIMARY_URL, FALLBACK_URL, fakeLogger());
    connectionFns.set(FALLBACK_URL, jest.fn().mockResolvedValue('fallback-ok'));

    await expect(pool.withFailover((c) => (c as unknown as { getBalance(): Promise<unknown> }).getBalance())).resolves.toBe('fallback-ok');
    await expect(
      pool.withFailover((c) => (c as unknown as { getSignatureStatuses(): Promise<unknown> }).getSignatureStatuses()),
    ).resolves.toBe('ok');
  });
});
