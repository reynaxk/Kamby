import { describe, expect, it, vi } from 'vitest';
import { settledOr } from './settled-fetch';

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
