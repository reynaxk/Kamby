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
    // Inside the phone app the website's landing page would drop you out of the app
    // (2026-10-10) — the app's own Home (welcome + sign in) instead.
    if (ready && !authenticated) router.replace(window.matchMedia('(max-width: 767px)').matches ? '/home' : '/');
  }, [ready, authenticated, router]);
  if (!ready || !authenticated) {
    return <div className="kamby-void min-h-screen bg-bg" aria-busy="true" />;
  }
  return <>{children}</>;
}
