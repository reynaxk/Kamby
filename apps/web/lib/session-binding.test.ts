import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ clientEnv: { NEXT_PUBLIC_API_BASE_URL: 'http://api' } }));
vi.mock('./referral-capture', () => ({ getCapturedReferralCode: () => null }));

import { bindSessionTo, endSession, hasStoredSession } from './session-client';

describe('session binding', () => {
  beforeEach(() => localStorage.clear());

  it('claims an existing session for the first sign-in it sees, and keeps it for that person', () => {
    localStorage.setItem('kamby:session-token', 'token-a');
    expect(bindSessionTo('privy-a')).toBe(false);
    expect(bindSessionTo('privy-a')).toBe(false);
    expect(hasStoredSession()).toBe(true);
  });

  it("drops the session when a different person signs in on the same device", () => {
    localStorage.setItem('kamby:session-token', 'token-a');
    bindSessionTo('privy-a');
    expect(bindSessionTo('privy-dad')).toBe(true);
    expect(hasStoredSession()).toBe(false);
  });

  it('sign-out forgets the session', () => {
    localStorage.setItem('kamby:session-token', 'token-a');
    endSession();
    expect(hasStoredSession()).toBe(false);
  });
});
