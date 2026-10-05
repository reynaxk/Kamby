import type { Metadata } from 'next';
import Link from 'next/link';
import { Orbitron } from 'next/font/google';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { FeatureCards, type LandingFeature } from '@/components/landing/FeatureCards';
import { LandingCta } from '@/components/landing/LandingCta';
import { RunnerCountdown } from '@/components/landing/RunnerCountdown';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

/** The wordmark face — loaded only on the landing page (self-hosted by next/font, no runtime request). */
const orbitron = Orbitron({ subsets: ['latin'], weight: ['800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Kamby — Find. Trade. Repeat. Gas-free.',
  description:
    'The high-performance multi-chain terminal built for raw execution. Trade meme coins on Solana, Base and BNB Chain with one USDC balance, automated gas sponsorship and real-time dry-run simulation.',
};

const NEON = '#00FF87';
const CYAN = '#00E5FF';
const SLATE = '#94A3B8';

/**
 * The landing page ("tactical" pass 2026-10-05): obsidian #0B0E14 under a fixed console grid,
 * floating green/cyan glows behind a metallic KAMBY wordmark, glass panels throughout, and a
 * live digital countdown in the closing call to action. New visitors see this, not the
 * terminal — "Launch Terminal" opens Privy sign-in, then /terminal. Static server render; the
 * only client code is the sign-in buttons, the card entry animations and the countdown.
 */
export default function LandingPage() {
  return (
    <div className="kamby-void kamby-landing relative min-h-screen overflow-x-hidden bg-[#0B0E14] text-white">
      {/* Fixed console grid across the whole screen */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.04] [background-image:linear-gradient(#ffffff_1px,transparent_1px),linear-gradient(90deg,#ffffff_1px,transparent_1px)] [background-size:40px_40px]"
      />
      {/* Floating ambient glows behind the wordmark and headline */}
      <div aria-hidden className="kamby-float-a pointer-events-none absolute left-[38%] top-[-120px] h-[560px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.24),transparent)] blur-3xl" />
      <div aria-hidden className="kamby-float-b pointer-events-none absolute left-[64%] top-[120px] h-[460px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,255,0.18),transparent)] blur-3xl" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <KambyLogo />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leaderboard"
            className="hidden rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 font-display text-sm font-semibold text-[#cbd5e1] backdrop-blur-md transition-all hover:border-white/25 hover:text-white sm:block"
          >
            Leaderboard
          </Link>
          <LandingCta label="Sign in" variant="ghost" className="px-4 py-2" />
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-10 text-center sm:pt-16">
          <div className="mx-auto inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-3 pr-1.5 backdrop-blur-md">
            <span className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-[#cbd5e1]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: NEON }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: NEON }} />
              </span>
              Live
            </span>
            <span className="flex items-center gap-1">
              {CHAINS.map(([chain, name]) => (
                <span key={chain} title={name} className="relative flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/40">
                  <ChainBadge chain={chain} className="!static !h-3.5 !w-3.5 !ring-0" />
                </span>
              ))}
            </span>
          </div>

          {/* Metallic wordmark: a blurred copy behind gives the back-glow */}
          <h1 className={`${orbitron.className} relative mt-8 select-none font-black leading-none tracking-[0.06em]`}>
            <span
              aria-hidden
              className="absolute inset-0 bg-clip-text text-[clamp(4.5rem,17vw,11.5rem)] text-transparent opacity-80 blur-2xl"
              style={{ backgroundImage: `linear-gradient(90deg, ${NEON}, ${CYAN})` }}
            >
              KAMBY
            </span>
            <span
              className="relative bg-clip-text text-[clamp(4.5rem,17vw,11.5rem)] text-transparent [filter:drop-shadow(0_2px_0_rgba(255,255,255,0.18))]"
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 42%), linear-gradient(100deg, ${NEON} 0%, #b6ffe0 34%, ${CYAN} 60%, #7df3ff 78%, ${NEON} 100%)`,
              }}
            >
              KAMBY
            </span>
          </h1>

          <h2 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            Find. Trade.{' '}
            <span className="relative inline-block">
              Repeat.
              <span className="absolute -right-2 -top-7 hidden translate-x-full -rotate-3 sm:block">
                <GasFreeBadge />
              </span>
            </span>
          </h2>
          {/* On phones the badge sits under the headline instead of beside it */}
          <div className="mt-4 flex justify-center sm:hidden">
            <GasFreeBadge />
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center font-body text-base leading-relaxed sm:text-lg" style={{ color: SLATE }}>
            The high-performance multi-chain terminal built for raw execution. Trade meme coins with automated gas sponsorship and real-time
            dry-run simulation.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LandingCta label="Launch Terminal" variant="neon" className="w-full sm:w-auto" />
            <Link
              href="/leaderboard"
              className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 font-display text-sm font-bold text-white backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/[0.08] sm:w-auto"
            >
              View Live Leaderboard
            </Link>
          </div>
          <p className="mt-4 font-mono text-[0.68rem] uppercase tracking-wider text-[#64748b]">Email or Google · free · just USDC</p>
        </section>

        {/* Stats — glass panels, facts about the product, never market data */}
        <section className="mx-auto max-w-5xl px-5 pb-20">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-[#00FF87]/45 hover:shadow-[0_0_28px_rgba(0,255,135,0.12)]"
              >
                <div className={`${orbitron.className} text-3xl font-extrabold text-white sm:text-4xl`}>{s.value}</div>
                <div className="mt-2 font-mono text-[0.66rem] uppercase tracking-[0.18em]" style={{ color: s.accent }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <p className="text-center font-mono text-[0.7rem] uppercase tracking-[0.25em]" style={{ color: NEON }}>
            {'// the stack'}
          </p>
          <h2 className="mt-2 text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Built for raw execution</h2>
          <FeatureCards features={FEATURES} />
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-5xl scroll-mt-10 px-5 pb-24">
          <h2 className="text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Trading in under a minute</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-[#00FF87]/45 hover:shadow-[0_0_28px_rgba(0,255,135,0.12)]"
              >
                <span className={`${orbitron.className} text-sm font-extrabold`} style={{ color: i === 1 ? CYAN : NEON }}>
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-display text-base font-bold text-white">{step.title}</h3>
                <p className="mt-1.5 font-body text-sm leading-relaxed" style={{ color: SLATE }}>
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Final CTA — live countdown */}
        <section className="mx-auto max-w-4xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-3xl border-2 border-[#00FF87]/60 bg-black/40 p-8 text-center shadow-[0_0_60px_rgba(0,255,135,0.15)] backdrop-blur-xl sm:p-14">
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-56 w-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.22),transparent)] blur-xl" />
            <p className="relative font-mono text-[0.7rem] font-bold uppercase tracking-[0.3em]" style={{ color: NEON }}>
              ● The next runner launches in
            </p>
            <div className="relative mt-6">
              <RunnerCountdown />
            </div>
            <h2 className="relative mt-8 font-display text-2xl font-black uppercase tracking-tight text-white sm:text-4xl">Be in the terminal when it does.</h2>
            <LandingCta label="Launch Terminal" variant="neon" className="relative mt-8" />
            <p className="relative mx-auto mt-8 max-w-xl font-body text-[0.7rem] leading-relaxed text-[#64748b]">
              Crypto is highly volatile and most new coins lose most or all of their value. Kamby never holds your funds; only trade what you can
              afford to lose.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function GasFreeBadge() {
  return (
    <span className="kamby-badge-pulse inline-flex whitespace-nowrap rounded-full border border-[#00FF87]/50 bg-[#00FF87]/10 px-3 py-1 font-display text-sm font-bold tracking-normal text-[#00FF87]">
      (and yeah... it&apos;s gas-free)
    </span>
  );
}

const CHAINS: [BadgeChain, string][] = [
  ['solana', 'Solana'],
  ['base', 'Base'],
  ['bnb', 'BNB Chain'],
];

const STATS = [
  { value: '3', label: 'Chains', accent: NEON },
  { value: '1', label: 'USDC balance', accent: CYAN },
  { value: '$0', label: 'Gas to buy', accent: NEON },
  { value: '1-tap', label: 'Buy & sell', accent: CYAN },
];

const FEATURES: LandingFeature[] = [
  { icon: '⚡', title: 'Every launchpad, live', body: 'New coins stream in the second they launch — Pump.fun, LetsBonk, Meteora, Clanker, four.meme and more.' },
  { icon: '⛽', title: 'Gas-free, automatically', body: 'Kamby sponsors the network fees on every chain. No ETH, BNB or SOL to buy first, no trades stuck on gas.' },
  { icon: '🧪', title: 'Dry-run before every trade', body: 'Each swap is simulated before it’s sent — a trade that would fail is stopped before it costs you anything.' },
  { icon: '$', title: 'One USDC balance', body: 'Deposit USDC on Solana, Base or BNB Chain, or buy it with a card. It’s the only asset you ever need.' },
  { icon: '📈', title: 'Charts that move', body: 'Live prices every 2 seconds, 10-second candles, and holder maps with whales, sharks and fish.' },
  { icon: '🛡', title: 'Safety checks built in', body: 'Honeypot, tax and authority checks filter the worst before a coin reaches you. Rug flags on the riskiest.' },
];

const STEPS = [
  { title: 'Sign in', body: 'Email or Google. Your wallet is created for you — no extension, no seed phrase.' },
  { title: 'Add USDC', body: 'Send USDC on Solana, Base or BNB Chain, or buy it with a card.' },
  { title: 'Launch the terminal', body: 'Pick a coin from Trending, Trenches or XXXRisk and buy it in one tap.' },
];
