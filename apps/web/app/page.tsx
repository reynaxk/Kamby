import type { Metadata } from 'next';
import Link from 'next/link';
import { Orbitron } from 'next/font/google';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { FeatureCards, type LandingFeature } from '@/components/landing/FeatureCards';
import { LandingCta } from '@/components/landing/LandingCta';
import { RunnerCountdown } from '@/components/landing/RunnerCountdown';

/** The wordmark and data face — loaded only on the landing page (self-hosted by next/font). */
const orbitron = Orbitron({ subsets: ['latin'], weight: ['700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Kamby — Find. Trade. Repeat. Gas-free.',
  description:
    'The high-performance multi-chain terminal built for raw execution. Trade meme coins on Solana, Base and BNB Chain with one USDC balance, automated gas sponsorship and real-time dry-run simulation.',
};

const NEON = '#00FF87';
const CYAN = '#00E5FF';

/**
 * The landing page (minimalist pass 2026-10-05): flat obsidian #080A0E, vast empty space, one
 * call to action. New visitors see this, not the terminal — "Launch Terminal" opens Privy
 * sign-in, then /terminal. Static server render; the only client code is the sign-in buttons,
 * the feature entry animations and the countdown. The risk notice lives in the site footer.
 */
export default function LandingPage() {
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-[#080A0E] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-2">
          <KambyLogo />
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/leaderboard" className="rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider text-[#64748B] transition-colors hover:text-white">
            Leaderboard
          </Link>
          <LandingCta label="Sign in" variant="ghost" className="px-4 py-2" />
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto flex min-h-[78vh] max-w-5xl flex-col items-center justify-center px-5 py-24 text-center">
          <p className="font-mono text-[0.72rem] lowercase tracking-[0.18em] text-[#3D5144]">chains: sol / base / bnb</p>

          <h1 className={`${orbitron.className} relative mt-6 select-none font-black leading-none tracking-[0.06em]`}>
            {/* A soft copy behind the wordmark, gently pulsing */}
            <span
              aria-hidden
              className="kamby-wordmark-pulse absolute inset-0 bg-clip-text text-[clamp(3.8rem,14.5vw,9.75rem)] text-transparent blur-2xl"
              style={{ backgroundImage: `linear-gradient(90deg, ${NEON}, ${CYAN})` }}
            >
              KAMBY
            </span>
            <span
              className="relative bg-clip-text text-[clamp(3.8rem,14.5vw,9.75rem)] text-transparent"
              style={{ backgroundImage: `linear-gradient(100deg, ${NEON} 0%, #b6ffe0 36%, ${CYAN} 62%, #7df3ff 80%, ${NEON} 100%)` }}
            >
              KAMBY
            </span>
          </h1>

          <h2 className="mt-8 font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
            Find. Trade. Repeat.
            <sup className="ml-2 align-super font-mono text-[0.68rem] font-normal tracking-normal text-[#94A3B8] sm:text-xs">(and yeah... it&apos;s gas-free)</sup>
          </h2>

          <LandingCta label="Launch Terminal" variant="neon" className="mt-14" />
        </section>

        {/* Data cells — facts about the product, never market data */}
        <section className="mx-auto max-w-5xl px-5 py-24">
          <div className="grid grid-cols-2 gap-y-14 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className={`${orbitron.className} text-5xl font-extrabold text-white sm:text-6xl`}>{s.value}</div>
                <div className="mt-3 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-[#546274]">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-5xl px-5 py-24">
          <FeatureCards features={FEATURES} />
        </section>

        {/* Final call to action — the countdown is the focus */}
        <section className="mx-auto max-w-3xl px-5 pb-32 pt-12">
          <div className="flex flex-col items-center rounded-[2rem] border border-[#00FF87]/25 bg-white/[0.01] px-6 py-16 text-center backdrop-blur-xl sm:py-20">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-[#3D5144]">next runner</p>
            <RunnerCountdown className={`${orbitron.className} mt-4 text-[clamp(4rem,16vw,8.5rem)] font-black leading-none text-white`} />
            <LandingCta label="Launch Terminal" variant="neon" className="mt-12" />
          </div>
        </section>
      </main>
    </div>
  );
}

const STATS = [
  { value: '3', label: 'Chains' },
  { value: '1', label: 'USDC balance' },
  { value: '$0', label: 'Gas to buy' },
  { value: '1-tap', label: 'Buy & sell' },
];

const FEATURES: LandingFeature[] = [
  { title: 'Every launchpad, live', body: 'Pump.fun, LetsBonk, Clanker, four.meme and more — the second they launch.' },
  { title: 'Gas-free', body: 'Kamby pays the network fees on every chain. You never hold ETH, BNB or SOL.' },
  { title: 'Dry-run first', body: 'Every swap is simulated before it’s sent. A trade that would fail never costs you.' },
  { title: 'One USDC balance', body: 'Deposit on Solana, Base or BNB Chain, or buy it with a card.' },
  { title: 'Charts that move', body: 'Live prices every 2 seconds and 10-second candles.' },
  { title: 'Safety built in', body: 'Honeypot, tax and authority checks before a coin reaches you.' },
];
