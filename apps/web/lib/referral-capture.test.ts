import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReferralCodeFromUrl, getCapturedReferralCode } from './referral-capture';

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

describe('referral-capture', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setUrl('');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures a ?ref= code from the URL on first visit', () => {
    setUrl('?ref=ABCD2345');

    captureReferralCodeFromUrl();

    expect(getCapturedReferralCode()).toBe('ABCD2345');
  });

  it('does nothing when the URL has no ref param', () => {
    setUrl('?utm_source=twitter');

    captureReferralCodeFromUrl();

    expect(getCapturedReferralCode()).toBeNull();
  });

  it('never overwrites an already-captured code — first touch wins', () => {
    setUrl('?ref=FIRST0001');
    captureReferralCodeFromUrl();

    setUrl('?ref=SECOND02');
    captureReferralCodeFromUrl();

    expect(getCapturedReferralCode()).toBe('FIRST0001');
  });

  it('does not throw when localStorage is unavailable (private browsing)', () => {
    setUrl('?ref=ABCD2345');
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => captureReferralCodeFromUrl()).not.toThrow();
    spy.mockRestore();
  });

  it('returns null (not throw) when reading fails', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(getCapturedReferralCode()).toBeNull();
    spy.mockRestore();
  });
});
