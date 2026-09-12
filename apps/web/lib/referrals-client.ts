'use client';

import type { ReferralSummaryDto } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';

/**
 * Unlike watchlist/trading, this never gates on an existing session first — every visitor
 * gets a referral code the moment they have any session at all (see
 * apps/api/src/identity/identity.service.ts), so `authedFetch` transparently minting one on
 * first call here (see lib/session-client.ts) is exactly the right behavior, not something
 * to guard against.
 */
export async function fetchMyReferralSummary(): Promise<ReferralSummaryDto> {
  const res = await authedFetch('/referrals/me');
  await expectOk(res, 'load your referral summary');
  return res.json();
}
