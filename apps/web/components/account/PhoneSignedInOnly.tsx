'use client';

import type { ReactNode } from 'react';
import { usePrivy } from '@privy-io/react-auth';

/** On phones, the Profile screen is just a sign-in screen until you're signed in (2026-10-10)
 *  — an empty wallet full of dashes looked broken. Desktop always shows its children. */
export function PhoneSignedInOnly({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  return <div className={ready && authenticated ? undefined : 'max-md:hidden'}>{children}</div>;
}
