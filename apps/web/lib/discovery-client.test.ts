import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionClientModule from './session-client';
import { fetchMyPnlHistory, fetchTokenTraders } from './discovery-client';

const fetchMock = vi.fn();

const { hasStoredSessionMock, authedFetchMock } = vi.hoisted(() => ({
  hasStoredSessionMock: vi.fn(),
  authedFetchMock: vi.fn(),
}));

// Keeps the real API_BASE/expectOk (fetchTokenTraders's own tests below rely on the real
// resolved base URL) — only hasStoredSession/authedFetch are overridden, for
// fetchMyPnlHistory's "never creates a session just to view" guard.
vi.mock('./session-client', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionClientModule>();
  return { ...actual, hasStoredSession: hasStoredSessionMock, authedFetch: authedFetchMock };
});

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
      buyCount24h: 0,
      sellCount24h: 0,
      buyerCount24h: 0,
      sellerCount24h: 0,
    });
  });

  it('throws on a non-404 non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });

    await expect(fetchTokenTraders('0xabc', 8453)).rejects.toThrow(/500/);
  });
});

describe('fetchMyPnlHistory', () => {
  afterEach(() => vi.clearAllMocks());

  it('never creates a session just to view — returns an empty, zero-point history for a browser with no session', async () => {
    hasStoredSessionMock.mockReturnValue(false);

    const result = await fetchMyPnlHistory(30);

    expect(result).toEqual({ days: 30, points: [] });
    expect(authedFetchMock).not.toHaveBeenCalled();
  });

  it('requests the given number of days via authedFetch and returns the parsed body', async () => {
    hasStoredSessionMock.mockReturnValue(true);
    const body = { days: 7, points: [{ date: '2026-01-01', realizedPnlUsd: 10, cumulativeRealizedPnlUsd: 10 }] };
    authedFetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });

    const result = await fetchMyPnlHistory(7);

    expect(result).toEqual(body);
    expect(authedFetchMock).toHaveBeenCalledWith('/social/pnl-history?days=7');
  });

  it('throws on a non-ok response', async () => {
    hasStoredSessionMock.mockReturnValue(true);
    authedFetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchMyPnlHistory()).rejects.toThrow(/500/);
  });
});
