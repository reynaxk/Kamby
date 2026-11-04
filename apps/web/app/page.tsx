import type { Metadata } from 'next';
import { HeroShowcase } from '@/components/landing/HeroShowcase';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';
import { ChainStrip } from '@/components/landing/LandingSections';
import { LandingCta } from '@/components/landing/LandingCta';
import { QuickBuyArt, RecordArt, SceneStyles, WhalesArt } from '@/components/landing/LiveScenes';
import { LegalAgreementNote } from '@/components/legal/LegalAgreementNote';
import { getTranslations } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Kamby — Social Terminal for Trading',
  description:
    'The social terminal for trading: find coins, follow whales and chat with traders on Solana, Base, BSC and Robinhood Chain.',
};

/**
 * The landing page — Kamby Prime (2026-11-04, owner: "build it how you would if you were me"):
 * a quiet hero (one line in white, one in grey, one button) over the live terminal and phone,
 * the chains, then one bento grid that says the five things that matter, and the sign-off.
 * Motion stays CSS scroll-driven (globals.css .kl-*), transform-first, never hidden.
 * New visitors see this; the buttons open Privy sign-in, then the app.
 */
const PADS = ['Pump.fun', 'Bonk', 'Meteora', 'Bags', 'LaunchLab', 'Four.meme', 'Clanker', 'Flap', 'Pons'];

export default async function LandingPage() {
  const t = await getTranslations('landing');
  // Up to 5s for the live coins: the hero is built from them (a slow API otherwise shows the
  // fallback picture).
  const feeds = await soft(fetchMarketFeeds(), null, 5000);
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#050607] text-white">
      <LandingHeader signIn={t('signIn')} start={t('heroCta')} links={[]} />
      <SceneStyles />

      <section id="top" className="relative isolate -mt-[4.5rem] overflow-hidden pt-[4.5rem]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_10%,black,transparent)]"
        />
        <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-12 pt-16 text-center lg:pt-28">
          <span className="kamby-gate-in rounded-full border border-white/10 bg-white/[0.02] px-3.5 py-1.5 text-xs font-medium text-white/60">
            Solana · Base · BSC · Robinhood Chain
          </span>
          <h1 className="kamby-gate-in kamby-gate-in-2 mt-8 max-w-5xl text-[clamp(2.9rem,8vw,5.6rem)] font-bold leading-[0.98] tracking-[-0.045em]">
            <span className="block text-white">{t('primeA')}</span>
            <span className="block text-[#5A606A]">{t('primeB')}</span>
          </h1>
          <p className="kamby-gate-in kamby-gate-in-3 mt-7 max-w-xl text-lg leading-relaxed text-[#8A909A] sm:text-[1.2rem]">{t('primeSub')}</p>
          <div className="kamby-gate-in kamby-gate-in-4 mt-10 flex w-full flex-col items-center gap-4">
            <LandingCta label={t('heroCta')} variant="neon" arrow className="w-full px-9 py-4 text-base sm:w-auto" />
            <LegalAgreementNote />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-5 pb-20">
          <div className="kl-tilt">
            <HeroShowcase tokens={feeds?.xxxrisk?.tokens ?? []} />
          </div>
        </div>
      </section>

      <section className="border-y border-white/[0.06] py-10">
        <ChainStrip />
      </section>

      <main className="mx-auto max-w-6xl px-5 pt-28">
        <h2 className="kl-rise max-w-3xl text-[clamp(2.2rem,5vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.04em]">
          <span className="block">{t('bentoA')}</span>
          <span className="block text-[#5A606A]">{t('bentoB')}</span>
        </h2>
        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-6">
          <Card n="01" title={t('b1t')} body={t('b1b')} className="lg:col-span-4">
            <div className="flex flex-wrap gap-2">
              {PADS.map((p) => (
                <span key={p} className="rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[0.8rem] text-white/80">
                  {p}
                </span>
              ))}
            </div>
          </Card>
          <Card n="02" title={t('b2t')} body={t('b2b')} className="lg:col-span-2">
            <QuickBuyArt />
          </Card>
          <Card n="03" title={t('b3t')} body={t('b3b')} className="lg:col-span-2">
            <span className="inline-flex rounded-lg border border-[#1F3A2C] bg-[#0D1A13] px-3 py-1.5 font-mono text-[0.8rem] text-[#7CF5B9]">Network fee · $0.00</span>
          </Card>
          <Card n="04" title={t('b4t')} body={t('b4b')} className="lg:col-span-4">
            <WhalesArt />
          </Card>
          <Card n="05" title={t('b5t')} body={t('b5b')} className="lg:col-span-6">
            <div className="mx-auto max-w-md">
              <RecordArt />
            </div>
          </Card>
        </div>
      </main>

      <section className="px-5 pb-32 pt-36 text-center">
        <h2 className="kl-rise mx-auto max-w-4xl text-[clamp(2.6rem,7vw,4.6rem)] font-bold leading-none tracking-[-0.045em] text-white">{t('primeClose')}</h2>
        <div className="mt-10 flex justify-center">
          <LandingCta label={t('heroCta')} variant="neon" arrow className="px-10 py-4 text-base" />
        </div>
      </section>
    </div>
  );
}

function Card({ n, title, body, className, children }: { n: string; title: string; body: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`kl-rise flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0A0B0E] p-7 ${className ?? ''}`}>
      <p className="font-mono text-xs text-[#5A606A]">{n}</p>
      <h3 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white">{title}</h3>
      <p className="mt-2 max-w-md text-[0.95rem] leading-relaxed text-[#8A909A]">{body}</p>
      <div className="mt-8 flex-1">{children}</div>
    </div>
  );
}
