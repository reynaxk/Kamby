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
export function LandingCta({
  label: labelProp,
  variant = 'primary',
  arrow = false,
  className,
}: {
  label?: string;
  variant?: 'primary' | 'ghost' | 'neon';
  /** A trailing → that nudges right on hover (the landing's main buttons, 2026-10-17). */
  arrow?: boolean;
  className?: string;
}) {
  const tU = useTranslations('ui');
  const tL = useTranslations('landing');
  const label = labelProp ?? tU('getStarted_be11');
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  useEffect(() => {
    if (ready && authenticated) router.replace(signedInHome());
  }, [ready, authenticated, router]);

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => (authenticated ? router.push(signedInHome()) : login())}
      className={cn(
        'group rounded-xl px-6 py-3 font-display text-sm font-bold transition-all disabled:opacity-60',
        variant === 'neon'
          ? 'bg-[#00FF87] px-8 py-3.5 text-black hover:brightness-110 active:scale-[0.98]'
          : variant === 'primary'
            ? 'bg-accent text-accent-ink hover:brightness-110'
            : 'border border-white/15 bg-white/[0.04] text-ink-900 backdrop-blur hover:border-[#00FF87]/50',
        className,
      )}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {!ready ? tL('loading') : authenticated ? tL('openTerminal') : label}
        {arrow && ready && (
          <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        )}
      </span>
    </button>
  );
}

/** Where a signed-in visitor goes from the landing page: the app's Home on a phone or in the
 *  installed app (2026-10-10, owner: "don't land on some coin right after opening the app" —
 *  an iPhone home-screen app opens on the page it was added from, here "/", and the phone
 *  terminal opens on a coin), the terminal on a desktop browser. */
function signedInHome(): string {
  const phone = window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(display-mode: standalone)').matches;
  return phone ? '/home' : '/terminal';
}
