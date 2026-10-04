'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The terminal is for signed-in users (user request 2026-10-04: new visitors see the landing
 * page, not charts and coins). Signed-out visitors are sent to "/"; nothing renders until Privy
 * knows, so the terminal never flashes for them.
 */
export function SignedInOnly({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);
  if (!ready || !authenticated) {
    return <div className="kamby-void min-h-screen bg-bg" aria-busy="true" />;
  }
  return <>{children}</>;
}
