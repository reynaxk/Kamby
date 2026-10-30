import type { Metadata } from 'next';
import Link from 'next/link';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { PnlShowcase } from '@/components/landing/PnlShowcase';
import { ChatShowcase } from '@/components/landing/ChatShowcase';
import { HeroPhone } from '@/components/landing/HeroPhone';
import { LandingTour } from '@/components/landing/LandingTour';
import { ChainStrip, HowItWorks, LandingFaq, UnderTheHood } from '@/components/landing/LandingSections';
import { LandingCta } from '@/components/landing/LandingCta';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Kamby — Social Terminal for Trading',
  description:
    'The social terminal for trading: find coins, follow whales and chat with traders on Solana, Base, BNB Chain and Robinhood Chain — with just USDC, no gas.',
};

/**
 * The landing page (2026-10-17 rewrite, owner: "10/10 aesthetic, ultra-smooth"): an obsidian
 * hero over a neon 3D grid with a live phone beside the pitch (2026-10-30: the feature bento is gone —
 * How it works, the tour and Under the hood already say it), the chats and PnL cards, a short FAQ,
 * and one last call to action (no countdown — owner 2026-10-17). New visitors see this, not the terminal — the buttons open Privy
 * sign-in, then the app. Server-rendered; the client code is the sign-in buttons and the live
 * scenes. All motion is transform/opacity. The risk notice lives in the
 * site footer.
 */
export default async function LandingPage() {
  const t = await getTranslations('landing');
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#050608] text-white">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* Ambient light: a neon wash from the top and a deep emerald pool behind the terminal */}
          <div className="absolute left-1/2 top-[-18rem] h-[42rem] w-[70rem] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(0,255,102,0.16),transparent)]" />
          <div className="absolute right-[-12rem] top-[18rem] h-[36rem] w-[44rem] bg-[radial-gradient(closest-side,rgba(16,185,129,0.12),transparent)]" />
          {/* The neon 3D grid, receding into the distance */}
          <div className="kamby-grid-floor absolute inset-x-[-25%] bottom-[-4rem] h-[46rem]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#050608] to-transparent" />
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

        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-24 pt-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-24 lg:pt-12">
          <div className="text-center lg:text-left">
            <h1 className="kamby-gate-in kamby-gate-in-2 font-display text-[clamp(2.6rem,7vw,4.6rem)] font-black leading-[1.02] tracking-tight">
              {/* 2026-10-30 owner: "Social Terminal for trading" — the neon part first; each locale keeps its own spacing */}
              <span className="whitespace-pre-wrap bg-[linear-gradient(100deg,#00FF87_0%,#B8FFE0_45%,#00E5FF_100%)] bg-clip-text text-transparent">{t('heroTitleA')}</span>
              <span className="bg-[linear-gradient(180deg,#FFFFFF_0%,rgba(255,255,255,0.72)_100%)] bg-clip-text text-transparent">{t('heroTitleB')}</span>
            </h1>
            <p className="kamby-gate-in kamby-gate-in-3 mx-auto mt-6 max-w-xl font-body text-lg leading-relaxed text-[#94A3B8] lg:mx-0">
              {t('heroSub')}
            </p>
            <div className="kamby-gate-in kamby-gate-in-4 mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <LandingCta label={t('heroCta')} variant="neon" arrow className="w-full px-9 py-4 text-base sm:w-auto" />
              <Link
                href="/leaderboard"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-7 py-4 text-center font-display text-sm font-bold text-white/80 transition-colors hover:border-white/25 hover:text-white sm:w-auto"
              >
                {t('leaderboard')}
              </Link>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroPhone />
          </div>
        </div>
      </section>

      <main>
        {/* 2026-10-29 (owner: "more introducing and explaining"): the chains, how it works in three
            steps, the live tour, and what happens inside when you tap Buy — before the features. */}
        <section className="-mt-8 pb-8">
          <ChainStrip />
        </section>
        <section className="mx-auto max-w-6xl px-5 py-20">
          <HowItWorks />
        </section>
        <section className="mx-auto max-w-6xl px-5 py-20">
          <LandingTour />
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

        <section className="mx-auto max-w-6xl px-5 py-20">
          <UnderTheHood />
        </section>

        <section className="mx-auto max-w-3xl px-5 py-20">
          <LandingFaq />
        </section>

        {/* The sign-off (2026-10-30 owner): only the slogan on clean black — no box, no glow, no chain list. */}
        <section className="px-5 pb-32 pt-16 text-center">
          <h2 className="font-display text-[clamp(2.4rem,8vw,4.5rem)] font-black leading-none tracking-tight text-white">{t('tagline')}</h2>
        </section>
      </main>
    </div>
  );
}
