'use client';

import { useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi';
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
 *
 * Two different `WagmiProvider`s, deliberately, as of the 2026-09-15 EVM-via-Privy
 * migration — see lib/wagmi-config.ts and lib/privy-config.ts for the rest of it. Read
 * `@privy-io/wagmi@4.0.17`'s actual compiled source before touching this: its
 * `WagmiProvider` wraps plain wagmi's own `WagmiProvider` around a `PrivyWagmiConnector`
 * child that calls `usePrivy()`/`useWallets()`/`useConnectWallet()`/`useLogin()` from
 * `@privy-io/react-auth` *unconditionally* on every render (to sync a connected Privy
 * wallet — embedded or external — into wagmi's connector state). Those hooks require a
 * `PrivyProvider` ancestor; rendering Privy's `WagmiProvider` without one is a real crash,
 * not a no-op. `wagmiConfig` itself (see wagmi-config.ts) is a plain wagmi `Config` object
 * regardless of which package's `createConfig` built it, so it works with *either*
 * `WagmiProvider` — only the provider component cares about Privy context, not the config
 * object it's holding.
 *
 * `QueryClientProvider` placement is load-bearing, not stylistic — a real build broke over
 * this (2026-09-15): `PrivyWagmiConnector`'s `useSyncPrivyWallets` calls wagmi's own
 * `useReconnect()`, which is itself built on TanStack Query's `useMutation` and needs a
 * `QueryClientProvider` *ancestor*. `PrivyWagmiConnector` always renders *between* Privy's
 * `WagmiProvider` and whatever `children` it's given — passing a `QueryClientProvider` as
 * that `children` puts it one level too low, still a descendant of `PrivyWagmiConnector`'s
 * own render, not an ancestor of it, and every prerendered page failed with "No QueryClient
 * set". `QueryClientProvider` has to wrap `PrivyWagmiProvider` itself. Plain wagmi's own
 * `WagmiProvider`, in the no-Privy fallback below, inserts no such interstitial component —
 * `WagmiProvider > QueryClientProvider > children` is fine there, and is also exactly the
 * order this codebase used before Privy's EVM support existed.
 *
 * `privyAppId` is already required in production today for the live Solana trading flow
 * (see privy-config.ts / SolanaTradePanel.tsx), so the plain-wagmi branch below exists for
 * local dev/test environments that don't set it, not as a real production code path — same
 * "off means off, cleanly" shape as every other optional config in this codebase. When
 * unset, EVM wallet connection falls back to plain wagmi's own `WagmiProvider` + the same
 * `injected()`/`walletConnect()` connectors (no Privy modal, no embedded wallets) rather
 * than crashing the whole app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Runs once, on first mount — the earliest point a `?ref=` in the URL can be captured
  // before client-side navigation strips it. See lib/referral-capture.ts.
  useEffect(() => {
    captureReferralCodeFromUrl();
  }, []);

  if (!privyAppId) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
