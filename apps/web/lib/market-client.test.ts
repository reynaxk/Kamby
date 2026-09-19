import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTokenHistory } from './market-client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTokenHistory', () => {
  it('requests the given address, timeframe, and chainId, returning the parsed JSON body', async () => {
    const body = [{ bucketStart: '2026-01-01T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5 }];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });

    const result = await fetchTokenHistory('0xabc', '1D', 8453);

    expect(result).toEqual(body);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v1/market/tokens/0xabc/history');
    expect(calledUrl.searchParams.get('timeframe')).toBe('1D');
    expect(calledUrl.searchParams.get('chainId')).toBe('8453');
  });

  it('omits chainId from the query when not given', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });

    await fetchTokenHistory('0xabc', '1H');

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.has('chainId')).toBe(false);
  });

  it('returns an empty array on a 404, rather than throwing — a token with no history yet is not an error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) });

    const result = await fetchTokenHistory('0xabc', '1D');

    expect(result).toEqual([]);
  });

  it('throws on a non-404 non-ok response rather than silently returning an empty result', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });

    await expect(fetchTokenHistory('0xabc', '1D')).rejects.toThrow(/500/);
  });
});
