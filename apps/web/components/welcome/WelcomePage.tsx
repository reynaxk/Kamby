'use client';

import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@kamby/ui';
import { WelcomeClosingCta } from './WelcomeClosingCta';
import { WelcomeFeatureGrid } from './WelcomeFeatureGrid';
import { WelcomeHero } from './WelcomeHero';

/**
 * What a signed-out visitor sees at `/` instead of the live terminal (see HomeGate) — a
 * real marketing entry point, shaped like fomo.family's own landing page (hero, feature
 * grid, closing CTA) but with Kamby's actual features, not fomo's copy or art. Its own
 * minimal top bar (just the wordmark + one Sign in button) deliberately doesn't reuse
 * MarketHeader — a search bar, notification bell, and blur-balances toggle all mean nothing
 * to someone who isn't signed in yet.
 *
 * `login()` is the same Privy call ConnectWalletButton already makes. The instant
 * `authenticated` flips true, HomeGate re-renders and swaps straight to the real terminal —
 * no navigation, no redirect, nothing else needed here.
 */
export function WelcomePage() {
  const { login } = usePrivy();

  return (
    <div className="kamby-void min-h-screen bg-bg">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            🔥
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-ink-900">
            Kamby
          </span>
        </div>
        <Button type="button" variant="secondary" onClick={() => login()}>
          Sign in
        </Button>
      </header>

      <WelcomeHero onStartTrading={() => login()} />
      <WelcomeFeatureGrid />
      <WelcomeClosingCta onStartTrading={() => login()} />
    </div>
  );
}
