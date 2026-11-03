import type { Metadata } from 'next';
import { PnlShowcase } from '@/components/landing/PnlShowcase';
import { HeroShowcase } from '@/components/landing/HeroShowcase';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';
import { ChainStrip } from '@/components/landing/LandingSections';
import { LandingCta } from '@/components/landing/LandingCta';
import { StorySection } from '@/components/landing/StorySection';
import { ChatArt, QuickBuyArt, RecordArt, SceneStyles, WhalesArt } from '@/components/landing/LiveScenes';
import { LegalAgreementNote } from '@/components/legal/LegalAgreementNote';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Kamby — Social Terminal for Trading',
  description:
    'The social terminal for trading: find coins, follow whales and chat with traders on Solana, Base, BSC and Robinhood Chain.',
};

/**
 * The landing page (2026-11-02 rewrite, owner: "super professional and aesthetic, scrolling
 * animations, slowly introduce Kamby — not too much info, the first screen can be better"):
 * a clean black hero with the live Hunt board standing up as you scroll, then one idea per
 * screen — buy in one tap, the whales, your record, trading together, flexing a win — and the
 * sign-off. Motion is CSS scroll-driven (globals.css .kl-*), transform-first, never hidden.
 * New visitors see this; the buttons open Privy sign-in, then the app. The risk notice lives in
 * the site footer.
 */
export default async function LandingPage() {
  const t = await getTranslations('landing');
  const tw = await getTranslations('whatsNew');
  // Up to 5s for the live coins: the hero is built from them (a slow API otherwise shows the
  // fallback picture).
  const feeds = await soft(fetchMarketFeeds(), null, 5000);
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#040506] text-white">
      <LandingHeader signIn={t('signIn')} start={t('heroCta')} links={[]} />
      <SceneStyles />

      {/* The first screen: one line, one button, and the real board. */}
      <section id="top" className="relative isolate -mt-[4.5rem] overflow-hidden pt-[4.5rem]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)]"
        />
        <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-10 pt-16 text-center lg:pt-24">
          <span className="kamby-gate-in rounded-full border border-white/10 px-3.5 py-1.5 font-body text-xs font-medium text-white/60">
            Solana · Base · BSC · Robinhood Chain
          </span>
          <h1 className="kamby-gate-in kamby-gate-in-2 mt-7 max-w-4xl font-display text-[clamp(3rem,8.5vw,6.2rem)] font-black leading-[0.98] tracking-[-0.035em]">
            <span className="text-[#00FF87]">{t('heroTitleA')}</span>
            <span className="text-white">{t('heroTitleB')}</span>
          </h1>
          <p className="kamby-gate-in kamby-gate-in-3 mt-7 max-w-xl font-body text-lg leading-relaxed text-[#8B94A3] sm:text-xl">{t('heroSub')}</p>
          <div className="kamby-gate-in kamby-gate-in-4 mt-10 flex w-full flex-col items-center gap-4">
            <LandingCta label={t('heroCta')} variant="neon" arrow className="w-full px-10 py-4 text-base sm:w-auto" />
            <LegalAgreementNote />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-24">
          <div className="kl-tilt">
            <HeroShowcase tokens={feeds?.xxxrisk?.tokens ?? []} />
          </div>
        </div>
      </section>

      <main>
        <StorySection n="01" tone="#00FF87" title={t('story1Title')} body={tw('s1Body')} art={<QuickBuyArt />} />
        <StorySection n="02" tone="#38BDF8" title={t('story2Title')} body={tw('s2Body')} art={<WhalesArt />} flip />
        <StorySection n="03" tone="#FACC15" title={t('story3Title')} body={tw('s3Body')} art={<RecordArt />} />
        <StorySection n="04" tone="#A78BFA" title={t('chatTitle')} body={tw('s4Body')} art={<ChatArt />} flip />

        {/* 05 — flex every win: the PnL cards marquee. */}
        <section className="kl-rise py-24">
          <PnlShowcase title={t('showcaseTitle')} body={t('showcaseBody')} note={t('showcaseNote')} />
        </section>

        <section className="pb-10">
          <ChainStrip />
        </section>

        {/* The sign-off: the slogan on clean black, and the way in. */}
        <section className="px-5 pb-32 pt-20 text-center">
          <h2 className="font-display text-[clamp(2.6rem,8vw,5rem)] font-black leading-none tracking-[-0.03em] text-white">{t('tagline')}</h2>
          <div className="mt-10 flex justify-center">
            <LandingCta label={t('heroCta')} variant="neon" arrow className="px-10 py-4 text-base" />
          </div>
        </section>
      </main>
    </div>
  );
}
