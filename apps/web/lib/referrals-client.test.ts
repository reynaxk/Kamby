import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMyReferralSummary } from './referrals-client';

const { authedFetch, expectOk } = vi.hoisted(() => ({
  authedFetch: vi.fn(),
  expectOk: vi.fn(),
}));

vi.mock('./session-client', () => ({ authedFetch, expectOk }));

function fakeResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => vi.clearAllMocks());

describe('referrals-client', () => {
  it('fetches the caller\'s own referral summary', async () => {
    const summary = { referralCode: 'ABCD2345', referredCount: 3, earnedUsdcAmountRaw: '1000000', earnedUsdcAmountFormatted: '1' };
    authedFetch.mockResolvedValue(fakeResponse(summary));

    const result = await fetchMyReferralSummary();

    expect(authedFetch).toHaveBeenCalledWith('/referrals/me');
    expect(result).toEqual(summary);
  });
});
