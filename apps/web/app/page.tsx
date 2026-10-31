import type { Metadata } from 'next';
import Link from 'next/link';
import { PnlShowcase } from '@/components/landing/PnlShowcase';
import { ChatShowcase } from '@/components/landing/ChatShowcase';
import { HeroTrio } from '@/components/landing/HeroTrio';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LiveShowcase } from '@/components/landing/LiveShowcase';
import { LandingTicker } from '@/components/landing/LandingTicker';
import { FeedShowcase } from '@/components/landing/FeedShowcase';
import { fetchLatestNews, fetchLiveRoomsNow, fetchMarketFeeds } from '@/lib/market-api';
import { LandingPulse } from '@/components/landing/LandingPulse';
import { soft } from '@/lib/soft';
import { LandingTour } from '@/components/landing/LandingTour';
import { ChainStrip, HowItWorks, LandingFaq, UnderTheHood } from '@/components/landing/LandingSections';
import { LandingCta } from '@/components/landing/LandingCta';
import { LegalAgreementNote } from '@/components/legal/LegalAgreementNote';
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
  // Real coins for the ticker under the hero — capped, so a slow feed never holds the page.
  const [feeds, news, rooms] = await Promise.all([soft(fetchMarketFeeds(), null), soft(fetchLatestNews(10), []), soft(fetchLiveRoomsNow(), [])]);
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#050608] text-white">
      <LandingHeader
        signIn={t('signIn')}
        links={[
          { href: '#how', label: t('navHow') },
          { href: '#live', label: t('navLive') },
          { href: '#feed', label: t('navFeed') },
          { href: '#chat', label: t('navChat') },
          { href: '#faq', label: t('navFaq') },
        ]}
      />
      {/* Hero */}
      <section id="top" className="relative isolate -mt-[4.5rem] overflow-hidden pt-[4.5rem]">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* Ambient light: a neon wash from the top and a deep emerald pool behind the terminal */}
          <div className="absolute left-1/2 top-[-18rem] h-[42rem] w-[70rem] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(0,255,102,0.16),transparent)]" />
          <div className="absolute right-[-12rem] top-[18rem] h-[36rem] w-[44rem] bg-[radial-gradient(closest-side,rgba(16,185,129,0.12),transparent)]" />
          {/* The neon 3D grid, receding into the distance */}
          <div className="kamby-grid-floor absolute inset-x-[-25%] bottom-[-4rem] h-[46rem]" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#050608] to-transparent" />
        </div>


        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-24 pt-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10 lg:pb-24 lg:pt-12">
          <div className="text-center lg:text-left">
            <h1 className="kamby-gate-in kamby-gate-in-2 font-display text-[clamp(2.6rem,7vw,4.6rem)] font-black leading-[1.02] tracking-tight">
              {/* 2026-10-30 owner: "Social Terminal for trading" — the neon part first; each locale keeps its own spacing */}
              <span className="whitespace-pre-wrap bg-[linear-gradient(100deg,#00FF87_0%,#B8FFE0_45%,#00E5FF_100%)] bg-clip-text text-transparent">{t('heroTitleA')}</span>
              <span className="bg-[linear-gradient(180deg,#FFFFFF_0%,rgba(255,255,255,0.72)_100%)] bg-clip-text text-transparent">{t('heroTitleB')}</span>
            </h1>
            <p className="kamby-gate-in kamby-gate-in-3 mx-auto mt-6 max-w-xl font-body text-lg leading-relaxed text-[#94A3B8] lg:mx-0">
              {t('heroSub')}
            </p>
            {/* What's inside, as four icons (2026-10-30 redesign, owner's concepts). */}
            <ul className="kamby-gate-in kamby-gate-in-3 mx-auto mt-8 flex max-w-md justify-center gap-6 lg:mx-0 lg:justify-start">
              {([
                ['featTrades', <path key="a" d="M3 17l6-6 4 4 8-8M14 7h7v7" />],
                ['featFeed', <path key="b" d="M4 6h16M4 12h16M4 18h10" />],
                ['featChat', <path key="c" d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />],
                ['featStreams', <path key="d" d="M2 7h14v10H2zM16 10l6-3v10l-6-3" />],
              ] as const).map(([key, icon]) => (
                <li key={key} className="flex w-[4.5rem] flex-col items-center gap-2 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-[#00FF87]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {icon}
                    </svg>
                  </span>
                  <span className="font-display text-[0.7rem] font-bold leading-tight text-white/75">{t(key)}</span>
                </li>
              ))}
            </ul>
            <div className="kamby-gate-in kamby-gate-in-4 mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <LandingCta label={t('heroCta')} variant="neon" arrow className="w-full px-9 py-4 text-base sm:w-auto" />
              <Link
                href="/leaderboard"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-7 py-4 text-center font-display text-sm font-bold text-white/80 transition-colors hover:border-white/25 hover:text-white sm:w-auto"
              >
                {t('leaderboard')}
              </Link>
            </div>
            <LegalAgreementNote className="kamby-gate-in kamby-gate-in-4 mt-4 lg:mx-0 lg:justify-start lg:text-left" />
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroTrio />
          </div>
        </div>
      </section>

      <main>
        {/* 2026-10-29 (owner: "more introducing and explaining"): the chains, how it works in three
            steps, the live tour, and what happens inside when you tap Buy — before the features. */}
        <div className="-mt-10 pb-10">
          <LandingTicker markets={feeds?.trending.markets ?? []} />
          <LandingPulse news={news ?? []} rooms={rooms ?? []} />
        </div>
        <section className="pb-8">
          <ChainStrip />
        </section>
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <HowItWorks />
        </section>
        <section className="mx-auto max-w-6xl px-5 py-20">
          <LandingTour />
        </section>

        {/* Live trading streams (2026-10-31) */}
        <section id="live" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <LiveShowcase
            kicker={t('liveKicker')}
            title={t('liveTitle')}
            body={t('liveBody')}
            points={[
              { icon: '📺', title: t('livePoint1'), body: t('livePoint1Body') },
              { icon: '⚡', title: t('livePoint2'), body: t('livePoint2Body') },
              { icon: '💸', title: t('livePoint3'), body: t('livePoint3Body') },
            ]}
          />
        </section>

        {/* The Feed (2026-10-31) */}
        <section id="feed" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <FeedShowcase kicker={t('feedKicker')} title={t('feedTitle')} body={t('feedBody')} chips={[t('feedChip1'), t('feedChip2'), t('feedChip3'), t('feedChip4')]} />
        </section>

        {/* Flex every win — the PnL cards marquee */}
        <section className="py-20">
          <PnlShowcase title={t('showcaseTitle')} body={t('showcaseBody')} note={t('showcaseNote')} />
        </section>

        {/* The chats */}
        <section id="chat" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
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

        <section id="faq" className="scroll-mt-20 mx-auto max-w-3xl px-5 py-20">
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
