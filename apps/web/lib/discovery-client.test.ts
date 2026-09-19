import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTokenTraders } from './discovery-client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTokenTraders', () => {
  it('requests the given address, chainId, and limit as an unauthenticated read (never authedFetch)', async () => {
    const body = { uniqueTraders24h: 5, recentTraders: [], activeTraders: [], recentLargeTrades: [], watcherCount: 1 };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });

    const result = await fetchTokenTraders('0xabc', 56, 8);

    expect(result).toEqual(body);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v1/market/tokens/0xabc/traders');
    expect(calledUrl.searchParams.get('chainId')).toBe('56');
    expect(calledUrl.searchParams.get('limit')).toBe('8');
    // A plain fetch was used, not authedFetch — no Authorization header, no session created.
    expect(fetchMock.mock.calls[0]![1]).toBeUndefined();
  });

  it('defaults the limit to 10 when not given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ uniqueTraders24h: null, recentTraders: [], activeTraders: [], recentLargeTrades: [], watcherCount: 0 }),
    });

    await fetchTokenTraders('0xabc', 8453);

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('limit')).toBe('10');
  });

  it('returns an honest empty connection on a 404, rather than throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve(null) });

    const result = await fetchTokenTraders('0xabc', 8453);

    expect(result).toEqual({
      uniqueTraders24h: null,
      recentTraders: [],
      activeTraders: [],
      recentLargeTrades: [],
      watcherCount: 0,
    });
  });

  it('throws on a non-404 non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });

    await expect(fetchTokenTraders('0xabc', 8453)).rejects.toThrow(/500/);
  });
});
