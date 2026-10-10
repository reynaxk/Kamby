'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@kamby/ui';
import { useTranslations } from 'next-intl';

/**
 * "Get started" on the landing page: opens Privy sign-in (email or Google — a wallet is created
 * automatically) and goes to the terminal once signed in. Returning, already-signed-in users
 * are sent straight there.
 */
export function LandingCta({ label: labelProp, variant = 'primary', className }: { label?: string; variant?: 'primary' | 'ghost' | 'neon'; className?: string }) {
  const tU = useTranslations('ui');
  const tL = useTranslations('landing');
  const label = labelProp ?? tU('getStarted_be11');
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace('/terminal');
  }, [ready, authenticated, router]);

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => (authenticated ? router.push('/terminal') : login())}
      className={cn(
        'rounded-xl px-6 py-3 font-display text-sm font-bold transition-all disabled:opacity-60',
        variant === 'neon'
          ? 'bg-[#00FF87] px-8 py-3.5 text-black ring-1 ring-[#00FF87]/60 shadow-[0_0_28px_rgba(0,255,135,0.45),0_0_70px_rgba(0,255,135,0.18)] hover:shadow-[0_0_44px_rgba(0,255,135,0.75),0_0_110px_rgba(0,255,135,0.35)] hover:brightness-105 active:scale-[0.98]'
          : variant === 'primary'
            ? 'bg-accent text-accent-ink shadow-glow-accent hover:brightness-110'
            : 'border border-white/15 bg-white/[0.04] text-ink-900 backdrop-blur hover:border-[#00FF87]/50',
        className,
      )}
    >
      {!ready ? tL('loading') : authenticated ? tL('openTerminal') : label}
    </button>
  );
}
