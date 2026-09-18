'use client';

import { authedFetch, expectOk } from './session-client';

/**
 * Browser-side calls for the self-serve identity surface — see
 * docs/TRADER_INTELLIGENCE.md#identity-username--pfp. Same `authedFetch`/`expectOk`
 * convention as lib/wallet-client.ts.
 */

export interface MyProfile {
  username: string | null;
  avatarUrl: string | null;
}

export async function fetchMyProfile(): Promise<MyProfile> {
  const res = await authedFetch('/identity/me');
  await expectOk(res, 'load your profile');
  return res.json();
}

export async function updateUsername(username: string): Promise<MyProfile> {
  const res = await authedFetch('/identity/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  await expectOk(res, 'update your username');
  return res.json();
}

/** Multipart, not JSON — `authedFetch` never sets a Content-Type itself, so letting the
 *  browser set its own multipart boundary here (by not overriding `headers`) is
 *  deliberate, not an oversight. */
export async function uploadAvatar(file: File): Promise<MyProfile> {
  const body = new FormData();
  body.append('file', file);
  const res = await authedFetch('/identity/profile/avatar', { method: 'POST', body });
  await expectOk(res, 'upload your profile picture');
  return res.json();
}
