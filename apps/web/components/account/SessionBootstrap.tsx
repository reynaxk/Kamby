'use client';

import { useWalletVerification } from '@/hooks/useWalletVerification';

/**
 * Links the signed-in wallet to this browser's Kamby account on screens that need "who am I"
 * but have no trade panel to do it (2026-10-18: a new user who opened Profile first saw an
 * anonymous, empty account). Same one-time auto-verify the trade panels run; renders nothing.
 */
export function SessionBootstrap() {
  useWalletVerification();
  return null;
}
