import type { Metadata } from 'next';
import Link from 'next/link';
import { Orbitron } from 'next/font/google';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { FeatureCards, type LandingFeature } from '@/components/landing/FeatureCards';
import { LandingCta } from '@/components/landing/LandingCta';
import { RunnerCountdown } from '@/components/landing/RunnerCountdown';
import { getTranslations } from 'next-intl/server';

/** The wordmark and countdown face — loaded only on the landing page (self-hosted by next/font). */
const orbitron = Orbitron({ subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Kamby — Find. Trade. Repeat. Gas-free.',
  description:
    'The high-performance multi-chain terminal built for raw execution. Trade meme coins on Solana, Base and BNB Chain with one USDC balance, sponsored gas and real-time dry-run simulation.',
};

const NEON = '#00FF87';
const CYAN = '#00E5FF';
const VIOLET = '#7C3AED';

/** "Green candles": ultra-thin beams rising from the horizon. Fixed positions, so the server render is stable. */
const BEAMS = [
  { left: 8, height: 34, color: NEON, delay: 0 },
  { left: 15, height: 52, color: CYAN, delay: 1.4 },
  { left: 22, height: 28, color: NEON, delay: 2.6 },
  { left: 29, height: 64, color: NEON, delay: 0.7 },
  { left: 36, height: 40, color: VIOLET, delay: 3.1 },
  { left: 43, height: 78, color: CYAN, delay: 1.9 },
  { left: 50, height: 92, color: NEON, delay: 0.2 },
  { left: 57, height: 70, color: CYAN, delay: 2.2 },
  { left: 64, height: 46, color: NEON, delay: 3.6 },
  { left: 71, height: 60, color: VIOLET, delay: 1.1 },
  { left: 78, height: 30, color: NEON, delay: 2.9 },
  { left: 85, height: 50, color: CYAN, delay: 0.5 },
  { left: 92, height: 26, color: NEON, delay: 2.0 },
];

/**
 * The landing page ("cyberpunk sunrise" pass 2026-10-05): pitch-obsidian #05070A, a glowing
 * green/cyan/violet horizon with thin beams rising from it, a metallic KAMBY, one call to
 * action. New visitors see this, not the terminal — "Launch Terminal" opens Privy sign-in,
 * then /terminal. Static server render; the only client code is the sign-in buttons, the
 * feature entry animations and the countdown. The risk notice lives in the site footer.
 */
export default async function LandingPage() {
  const t = await getTranslations('landing');
  const features: LandingFeature[] = [
    { icon: '⚡', title: t('f1Title'), body: t('f1Body') },
    { icon: '🛡️', title: t('f2Title'), body: t('f2Body') },
    { icon: '🏎️', title: t('f3Title'), body: t('f3Body') },
  ];
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#05070A] text-white">
      {/* Hero — the sunrise sits behind it */}
      <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* Beams rising from the horizon */}
          {BEAMS.map((b) => (
            <span
              key={b.left}
              className="kamby-beam absolute bottom-[26%] w-px"
              style={{
                left: `${b.left}%`,
                height: `${b.height}%`,
                background: `linear-gradient(to top, ${b.color}, ${b.color}55 40%, transparent)`,
                animationDelay: `${b.delay}s`,
              }}
            />
          ))}
          {/* Sky glow above the horizon */}
          <div className="absolute bottom-[18%] left-1/2 h-[46%] w-[120%] -translate-x-1/2 bg-[radial-gradient(ellipse_50%_60%_at_50%_100%,rgba(0,255,135,0.16),rgba(0,229,255,0.07)_45%,transparent_75%)]" />
          {/* The horizon: three stacked arcs blend violet → cyan → green at the rim */}
          <div
            className="absolute left-1/2 top-[74%] h-[110vh] w-[190vw] -translate-x-1/2 rounded-[50%] bg-[#05070A] sm:w-[150vw]"
            style={{ boxShadow: `0 -1px 0 0 ${VIOLET}aa, 0 -18px 90px 4px ${VIOLET}44` }}
          />
          <div
            className="absolute left-1/2 top-[74.4%] h-[110vh] w-[180vw] -translate-x-1/2 rounded-[50%] bg-[#05070A] sm:w-[140vw]"
            style={{ boxShadow: `0 -1px 0 0 ${CYAN}cc, 0 -14px 70px 2px ${CYAN}40` }}
          />
          <div
            className="absolute left-1/2 top-[74.8%] h-[110vh] w-[170vw] -translate-x-1/2 rounded-[50%] bg-[#05070A] sm:w-[130vw]"
            style={{ boxShadow: `0 -2px 0 0 ${NEON}, 0 -10px 60px 6px ${NEON}55, 0 -40px 160px 20px ${NEON}22` }}
          />
        </div>

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
          <div className="flex items-center gap-2">
            <KambyLogo />
          </div>
          <nav className="flex items-center gap-1">
            <Link href="/leaderboard" className="rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider text-[#64748B] transition-colors hover:text-white">
              {t('leaderboard')}
            </Link>
            <LandingCta label={t('signIn')} variant="ghost" className="px-4 py-2" />
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-5 pb-[34vh] pt-[8vh] text-center">
          <p className="font-mono text-[0.72rem] lowercase tracking-[0.2em] text-[#3D7A58]">{t('chains')}</p>

          <h1 className={`${orbitron.className} relative mt-6 select-none font-black leading-none tracking-[0.06em]`}>
            {/* Metallic green back-lighting */}
            <span
              aria-hidden
              className="kamby-wordmark-pulse absolute inset-0 bg-clip-text text-[clamp(4rem,15.5vw,10.5rem)] text-transparent blur-2xl"
              style={{ backgroundImage: `linear-gradient(90deg, ${NEON}, #34ffb0, ${NEON})` }}
            >
              KAMBY
            </span>
            <span
              className="relative bg-clip-text text-[clamp(4rem,15.5vw,10.5rem)] text-transparent"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 45%), linear-gradient(100deg, ${NEON} 0%, #c8ffe6 38%, ${CYAN} 64%, ${NEON} 100%)`,
              }}
            >
              KAMBY
            </span>
          </h1>

          <h2 className="mt-8 font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
            {t('tagline')}{' '}
            <span className="whitespace-nowrap align-middle font-mono text-xs font-medium tracking-normal sm:text-sm" style={{ color: NEON, textShadow: `0 0 12px ${NEON}88` }}>
              {t('gasFree')}
            </span>
          </h2>

          <LandingCta label={t('goTrade')} variant="neon" className="mt-12 px-10 py-4 text-base" />
        </div>
      </section>

      <main>
        {/* Three features */}
        <section className="mx-auto max-w-5xl px-5 py-24">
          <FeatureCards features={features} />
        </section>

        {/* Bottom action box */}
        <section className="mx-auto max-w-3xl px-5 pb-32 pt-8">
          <div className="flex flex-col items-center rounded-[2rem] border border-white/5 bg-white/[0.015] px-6 py-16 text-center backdrop-blur-xl sm:py-20">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#3D7A58]">{t('nextRunner')}</p>
            <RunnerCountdown className={`${orbitron.className} mt-4 text-[clamp(3.6rem,14vw,7.5rem)] font-black leading-none text-white`} />
            <LandingCta label={t('goTrade')} variant="neon" className="mt-12 px-10 py-4 text-base" />
          </div>
        </section>
      </main>
    </div>
  );
}

