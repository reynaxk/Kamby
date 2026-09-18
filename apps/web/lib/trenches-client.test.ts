import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrenches, isPumpFunCategory } from './trenches-client';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPumpFunCategory', () => {
  it('is true for FRESH, NEAR_GRADUATED, and JUST_GRADUATED', () => {
    expect(isPumpFunCategory('FRESH')).toBe(true);
    expect(isPumpFunCategory('NEAR_GRADUATED')).toBe(true);
    expect(isPumpFunCategory('JUST_GRADUATED')).toBe(true);
  });

  it('is false for TRENDING_HOLDERS', () => {
    expect(isPumpFunCategory('TRENDING_HOLDERS')).toBe(false);
  });
});

describe('fetchTrenches', () => {
  it('requests the given category and limit, returning the parsed JSON body', async () => {
    const body = [{ mintAddress: 'Mint1' }];
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

    const result = await fetchTrenches('FRESH', 10);

    expect(result).toEqual(body);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('category')).toBe('FRESH');
    expect(calledUrl.searchParams.get('limit')).toBe('10');
  });

  it('defaults the limit to 20 when not given', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

    await fetchTrenches('TRENDING_HOLDERS');

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('limit')).toBe('20');
  });

  it('throws on a non-ok response rather than silently returning an empty result', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });

    await expect(fetchTrenches('FRESH')).rejects.toThrow(/500/);
  });
});
