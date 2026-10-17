import type { Metadata } from 'next';
import Link from 'next/link';
import { Orbitron } from 'next/font/google';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { FeatureCards, type LandingFeature } from '@/components/landing/FeatureCards';
import { PnlShowcase } from '@/components/landing/PnlShowcase';
import { ChatShowcase } from '@/components/landing/ChatShowcase';
import { TerminalMockup } from '@/components/landing/TerminalMockup';
import { LandingCta } from '@/components/landing/LandingCta';
import { RunnerCountdown } from '@/components/landing/RunnerCountdown';
import { getTranslations } from 'next-intl/server';

/** The countdown face — loaded only on the landing page (self-hosted by next/font). */
const orbitron = Orbitron({ subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Kamby — Multi-Chain Meme Coin Terminal',
  description:
    'Find. Trade. Repeat. Trade meme coins on Solana, Base, BNB Chain and Robinhood Chain with just USDC — no native gas, simulated before every swap.',
};

/**
 * The landing page (2026-10-17 rewrite, owner: "10/10 aesthetic, ultra-smooth"): an obsidian
 * hero over a neon 3D grid with a frosted preview of the terminal beside the pitch, the
 * features as a bento grid, the PnL cards drifting past in a marquee, both chats live-looking,
 * and one last call to action. New visitors see this, not the terminal — the buttons open Privy
 * sign-in, then the app. Server-rendered; the client code is the sign-in buttons, the bento
 * tiles' tilt and the countdown. All motion is transform/opacity. The risk notice lives in the
 * site footer.
 */
export default async function LandingPage() {
  const t = await getTranslations('landing');
  const features: LandingFeature[] = [
    { icon: 'gas', title: t('f1Title'), body: t('f1Body') },
    { icon: 'dollar', title: t('f3Title'), body: t('f3Body') },
    { icon: 'shield', title: t('f2Title'), body: t('f2Body') },
    { icon: 'launch', title: t('f4Title'), body: t('f4Body') },
    { icon: 'chat', title: t('f5Title'), body: t('f5Body') },
    { icon: 'card', title: t('f6Title'), body: t('f6Body') },
  ];
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#050608] text-white">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* Ambient light: a neon wash from the top and a deep emerald pool behind the terminal */}
          <div className="absolute left-1/2 top-[-18rem] h-[42rem] w-[70rem] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(0,255,102,0.16),transparent)]" />
          <div className="absolute right-[-12rem] top-[18rem] h-[36rem] w-[44rem] bg-[radial-gradient(closest-side,rgba(16,185,129,0.12),transparent)]" />
          {/* The neon 3D grid, receding into the distance */}
          <div className="kamby-grid-floor absolute inset-x-[-25%] bottom-[-8rem] h-[34rem]" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050608] to-transparent" />
        </div>

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <div className="flex items-center gap-2">
            <KambyLogo />
          </div>
          <nav className="flex items-center gap-1">
            <Link href="/leaderboard" className="hidden rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider text-[#64748B] transition-colors hover:text-white sm:block">
              {t('leaderboard')}
            </Link>
            <LandingCta label={t('signIn')} variant="ghost" className="px-4 py-2" />
          </nav>
        </header>

        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-24 pt-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-32 lg:pt-16">
          <div className="text-center lg:text-left">
            <p className="kamby-gate-in inline-flex items-center gap-2 rounded-full border border-[#00FF87]/20 bg-[#00FF87]/[0.06] px-3 py-1 font-mono text-[0.68rem] lowercase tracking-[0.18em] text-[#5BE3A0]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FF87]" />
              {t('chains')}
            </p>
            <h1 className="kamby-gate-in kamby-gate-in-2 mt-6 font-display text-[clamp(2.6rem,7vw,4.6rem)] font-black leading-[1.02] tracking-tight">
              <span className="bg-[linear-gradient(180deg,#FFFFFF_0%,rgba(255,255,255,0.72)_100%)] bg-clip-text text-transparent">{t('heroTitleA')} </span>
              <span className="bg-[linear-gradient(100deg,#00FF87_0%,#B8FFE0_45%,#00E5FF_100%)] bg-clip-text text-transparent">{t('heroTitleB')}</span>
            </h1>
            <p className="kamby-gate-in kamby-gate-in-3 mx-auto mt-6 max-w-xl font-body text-lg leading-relaxed text-[#94A3B8] lg:mx-0">
              <span className="font-semibold text-white">{t('tagline')}</span> — {t('heroSub')}
            </p>
            <div className="kamby-gate-in kamby-gate-in-4 mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <LandingCta label={t('heroCta')} variant="neon" arrow className="kamby-cta-pulse w-full px-9 py-4 text-base sm:w-auto" />
              <Link
                href="/leaderboard"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-7 py-4 text-center font-display text-sm font-bold text-white/80 transition-colors hover:border-white/25 hover:text-white sm:w-auto"
              >
                {t('leaderboard')}
              </Link>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <TerminalMockup />
          </div>
        </div>
      </section>

      <main>
        {/* What Kamby does — bento */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <FeatureCards features={features} />
        </section>

        {/* Flex every win — the PnL cards marquee */}
        <section className="py-20">
          <PnlShowcase title={t('showcaseTitle')} body={t('showcaseBody')} note={t('showcaseNote')} />
        </section>

        {/* The chats */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <ChatShowcase
            title={t('chatTitle')}
            body={t('chatBody')}
            pulseTitle={t('chatPulse')}
            pulseSub={t('chatPulseSub')}
            coinTitle={t('chatCoin')}
            coinSub={t('chatCoinSub')}
          />
        </section>

        {/* Bottom action box */}
        <section className="mx-auto max-w-3xl px-5 pb-32 pt-8">
          <div className="relative flex flex-col items-center overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01)_60%)] px-6 py-16 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:py-20">
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(0,255,102,0.18),transparent)]" />
            <p className="relative font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#3D7A58]">{t('nextRunner')}</p>
            <RunnerCountdown className={`${orbitron.className} relative mt-4 text-[clamp(3.6rem,14vw,7.5rem)] font-black leading-none text-white`} />
            <LandingCta label={t('goTrade')} variant="neon" arrow className="kamby-cta-pulse relative mt-12 px-10 py-4 text-base" />
          </div>
        </section>
      </main>
    </div>
  );
}
