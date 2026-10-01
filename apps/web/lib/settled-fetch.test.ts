import { describe, expect, it, vi } from 'vitest';
import { settledOr, settledWithin } from './settled-fetch';

describe('settledOr', () => {
  it('returns the resolved value when the promise succeeds', async () => {
    await expect(settledOr(Promise.resolve(['a', 'b']), [])).resolves.toEqual(['a', 'b']);
  });

  it('returns the fallback, never throwing, when the promise rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(settledOr(Promise.reject(new Error('backend down')), [])).resolves.toEqual([]);

    consoleError.mockRestore();
  });

  it('logs the failure server-side rather than swallowing it silently', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('backend down');

    await settledOr(Promise.reject(error), null);

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('a page section fetch failed'), error);
    consoleError.mockRestore();
  });
});

describe('settledWithin', () => {
  it('returns the value when it arrives in time', async () => {
    expect(await settledWithin(Promise.resolve(5), 50)).toBe(5);
  });
  it('returns undefined when the fetch is too slow or fails', async () => {
    expect(await settledWithin(new Promise((r) => setTimeout(() => r(5), 200)), 20)).toBeUndefined();
    expect(await settledWithin(Promise.reject(new Error('x')), 50)).toBeUndefined();
  });
});
