'use client';

import { useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { privyAppId, privyConfig } from '@/lib/privy-config';
import { captureReferralCodeFromUrl } from '@/lib/referral-capture';
import { wagmiConfig } from '@/lib/wagmi-config';

/**
 * wagmi requires a TanStack Query client for its internal caching — this app otherwise has
 * no React Query usage (see docs/SOCIAL.md's hand-rolled useState/useTransition pattern),
 * so this QueryClient exists solely to satisfy that requirement, not as a general data
 * layer. One instance per browser session, created lazily so it survives Fast Refresh in
 * development without being recreated on every render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Runs once, on first mount — the earliest point a `?ref=` in the URL can be captured
  // before client-side navigation strips it. See lib/referral-capture.ts.
  useEffect(() => {
    captureReferralCodeFromUrl();
  }, []);

  const app = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );

  // Additive, not a replacement for WagmiProvider above — Privy owns Solana embedded-wallet
  // auth only; the existing EVM wallet flow (wagmi) is completely untouched either way. See
  // docs/TRADING.md#solana. Omitted entirely (not half-initialized) when
  // NEXT_PUBLIC_PRIVY_APP_ID isn't configured — see lib/privy-config.ts.
  if (!privyAppId) return app;
  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      {app}
    </PrivyProvider>
  );
}
