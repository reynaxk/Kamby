'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';
import { LegalAgreementNote } from '@/components/legal/LegalAgreementNote';

/** Open without an account: the landing page and the legal pages. Everything else — coins, the
 *  terminal, the leaderboard, shared coin links — needs a sign-in first (owner, 2026-10-13). */
const PUBLIC_PATHS = ['/', '/terms', '/privacy', '/risk'];
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/offline');
}

/** Runs before first paint (inline in <head>): with no saved sign-in on a locked page, the app is
 *  hidden and the sign-in screen shown at once — no coins flash by before Privy has loaded.
 *  Privy's own token or Kamby's session token counts as "probably signed in"; AuthGate below
 *  corrects either way as soon as Privy knows. */
export const AUTH_GATE_SCRIPT = `try{var p=location.pathname;var pub=${JSON.stringify(PUBLIC_PATHS)}.indexOf(p)>=0||p.indexOf('/offline')===0;var ls=window.localStorage;var signed=!!(ls.getItem('privy:token')||ls.getItem('privy:refresh_token')||ls.getItem('kamby:session-token'));if(!pub&&!signed){document.documentElement.classList.add('kamby-locked')}}catch(e){}`;

/**
 * The sign-in wall: a full Kamby welcome screen in place of the app for anyone not signed in.
 * Its markup is always in the page (hidden unless `html.kamby-locked`), so it shows on the very
 * first paint; once Privy is ready this keeps the lock in step with the real sign-in state and
 * with client-side navigation between locked and public pages.
 */
export function AuthGate() {
  const { ready, authenticated, login } = usePrivy();
  const pathname = usePathname() ?? '/';
  const t = useTranslations('gate');
  const tL = useTranslations('landing');

  useEffect(() => {
    const root = document.documentElement;
    if (isPublicPath(pathname)) {
      root.classList.remove('kamby-locked');
      return;
    }
    if (!ready) return; // the inline script's guess stands until Privy knows
    root.classList.toggle('kamby-locked', !authenticated);
  }, [ready, authenticated, pathname]);

  return (
    <div id="kamby-gate" className="kamby-void fixed inset-0 z-[90] flex-col overflow-y-auto bg-bg">
      {/* The landing's neon horizon, quietly — this is Kamby's front door. */}
      <div aria-hidden className="kamby-gate-horizon pointer-events-none absolute inset-x-0 bottom-0 h-[55%]" />
      <div className="relative mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+3rem)] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, must paint before JS */}
        <img src="/brand/kamby-mark.svg" alt="" className="kamby-gate-in h-24 w-24" />
        <p className="kamby-gate-in kamby-gate-in-2 mt-6 bg-gradient-to-r from-[#00FF87] to-[#00D9FF] bg-clip-text font-display text-5xl font-extrabold tracking-[0.08em] text-transparent">
          KAMBY
        </p>
        <p className="kamby-gate-in kamby-gate-in-3 mt-3 font-display text-lg font-semibold text-ink-900">{tL('tagline')}</p>
        <p className="kamby-gate-in kamby-gate-in-3 mt-2 font-body text-sm text-ink-400">{t('sub')}</p>
        <button
          type="button"
          onClick={() => login()}
          disabled={!ready}
          className="kamby-gate-in kamby-gate-in-4 mt-10 h-14 w-full rounded-2xl bg-accent font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {t('cta')}
        </button>
        <p className="kamby-gate-in kamby-gate-in-4 mt-3 font-body text-xs text-ink-400">{t('how')}</p>
        <div className="kamby-gate-in kamby-gate-in-4 w-full">
          <LegalAgreementNote />
        </div>
        <LanguageSelect className="kamby-gate-in kamby-gate-in-4 mt-8 w-full" />
      </div>
    </div>
  );
}
