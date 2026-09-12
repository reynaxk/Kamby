import { describe, expect, it, vi } from 'vitest';
import { retryRpcCall } from './retry';

describe('retryRpcCall', () => {
  it('returns the result immediately on a first-try success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryRpcCall(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('rate limited')).mockResolvedValueOnce('ok');
    await expect(retryRpcCall(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up and rethrows the last error after exhausting attempts', async () => {
    const err = new Error('still down');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryRpcCall(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
