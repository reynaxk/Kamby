'use client';

import type { ReactNode } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { WelcomePage } from './WelcomePage';

/**
 * Gates the homepage: signed-in visitors see the real terminal (`children`, already
 * server-rendered with real data by app/page.tsx) exactly as before; everyone else sees
 * `WelcomePage` instead. `ready`/`authenticated` only resolve client-side (Privy has no
 * server-readable session in this app — see ConnectWalletButton's identical `!ready` check),
 * so every visitor briefly sees `GateLoading` first, logged in or not — the same cost
 * `ConnectWalletButton`'s own "Loading…" state already pays everywhere else.
 *
 * Every other route stays fully ungated — a logged-out visitor who navigates straight to a
 * token page or the leaderboard still gets the real, pre-auth-friendly UI, not this page.
 */
export function HomeGate({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();

  if (!ready) return <GateLoading />;
  if (!authenticated) return <WelcomePage />;
  return <>{children}</>;
}

function GateLoading() {
  return (
    <div className="kamby-void flex min-h-screen items-center justify-center bg-bg">
      <div className="flex animate-fade-in items-center gap-2 opacity-60">
        <KambyLogo />
      </div>
    </div>
  );
}
