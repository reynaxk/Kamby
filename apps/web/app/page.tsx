import type { Metadata } from 'next';
import Link from 'next/link';
import { Orbitron } from 'next/font/google';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { LandingCta } from '@/components/landing/LandingCta';
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

/**
 * The landing page (redesign 2026-10-05): obsidian background, matrix grid, a glowing KAMBY
 * wordmark and "Find. Trade. Repeat." New visitors see this, not the terminal — "Go Trade"
 * opens Privy sign-in, then the terminal. Fully static (no API calls), so it's the fastest
 * page on the site; the only client code is the sign-in button.
 */
export default function LandingPage() {
  return (
    <div className="kamby-void kamby-landing relative min-h-screen overflow-x-hidden bg-[#0B0E14] text-ink-900">
      {/* Matrix grid, fading out from the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[1100px] opacity-[0.35] [background-image:linear-gradient(rgba(0,255,135,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.07)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]"
      />
      {/* Ambient glows behind the wordmark and headline */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-140px] h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.22),transparent)] blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute left-[62%] top-[180px] h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,229,255,0.16),transparent)] blur-2xl" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <KambyLogo />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/leaderboard" className="hidden rounded-xl px-3 py-2 font-display text-sm font-semibold text-ink-600 transition-colors hover:text-ink-900 sm:block">
            Leaderboard
          </Link>
          <LandingCta label="Sign in" variant="ghost" className="px-4 py-2" />
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-5 pb-20 pt-12 text-center sm:pt-20">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink-600 backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: NEON }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: NEON }} />
            </span>
            Live on Solana · Base · BNB Chain
          </p>

          {/* Wordmark: a blurred copy behind gives the back-glow */}
          <h1 className={`${orbitron.className} relative mt-8 select-none font-black leading-none tracking-[0.06em]`}>
            <span aria-hidden className="absolute inset-0 bg-clip-text text-transparent opacity-70 blur-2xl" style={{ backgroundImage: `linear-gradient(90deg, ${NEON}, ${CYAN})` }}>
              KAMBY
            </span>
            <span
              className="relative bg-clip-text text-[clamp(4.5rem,17vw,11.5rem)] text-transparent"
              style={{ backgroundImage: `linear-gradient(100deg, ${NEON} 0%, #b6ffe0 38%, ${CYAN} 62%, #7df3ff 80%, ${NEON} 100%)` }}
            >
              KAMBY
            </span>
          </h1>

          <h2 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            Find. Trade.{' '}
            <span className="relative inline-block">
              Repeat.
              <span
                className="absolute -right-2 -top-7 hidden translate-x-full -rotate-3 whitespace-nowrap rounded-full border px-3 py-1 font-display text-sm font-bold tracking-normal sm:block"
                style={{ color: NEON, borderColor: `${NEON}55`, background: `${NEON}14`, textShadow: `0 0 12px ${NEON}aa`, boxShadow: `0 0 24px ${NEON}33` }}
              >
                (and yeah... it&apos;s Gas-Free.)
              </span>
            </span>
          </h2>
          {/* On phones the badge sits under the headline instead of beside it */}
          <p className="mt-3 font-display text-base font-bold sm:hidden" style={{ color: NEON, textShadow: `0 0 12px ${NEON}aa` }}>
            (and yeah... it&apos;s Gas-Free.)
          </p>

          <p className="mx-auto mt-6 max-w-2xl font-body text-base leading-relaxed text-ink-600 sm:text-lg">
            The high-performance multi-chain terminal built for raw execution. Trade meme coins with automated gas sponsorship and real-time
            dry-run simulation.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LandingCta label="Go Trade" variant="neon" className="w-full sm:w-auto" />
            <Link
              href="/leaderboard"
              className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-7 py-3.5 font-display text-sm font-bold text-white backdrop-blur-md transition-all hover:border-white/30 hover:bg-white/[0.08] sm:w-auto"
            >
              View Live Leaderboard
            </Link>
          </div>
          <p className="mt-4 font-body text-xs text-ink-400">Sign in with email or Google · free to join · just USDC</p>

          {/* Chains */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
            {(
              [
                ['solana', 'Solana'],
                ['base', 'Base'],
                ['bnb', 'BNB Chain'],
              ] as [BadgeChain, string][]
            ).map(([chain, name]) => (
              <span key={chain} className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 font-display text-sm font-semibold text-white backdrop-blur">
                <span className="relative h-5 w-5">
                  <ChainBadge chain={chain} className="!static !h-5 !w-5 !ring-0" />
                </span>
                {name}
              </span>
            ))}
          </div>
        </section>

        {/* Stats strip — facts about the product, never market data */}
        <section className="mx-auto max-w-5xl px-5 pb-20">
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="border-white/10 px-4 py-6 text-center [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
                <div className={`${orbitron.className} text-2xl font-extrabold sm:text-3xl`} style={{ color: s.accent }}>
                  {s.value}
                </div>
                <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-wider text-ink-400">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <h2 className="text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Built for raw execution</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-6 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-[#00FF87]/40"
              >
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.18),transparent)] opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#00FF87]/30 bg-[#00FF87]/10 text-lg">{f.icon}</div>
                <h3 className="mt-4 font-display text-base font-bold text-white">{f.title}</h3>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-ink-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-5xl scroll-mt-10 px-5 pb-24">
          <h2 className="text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Trading in under a minute</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 backdrop-blur">
                <span className={`${orbitron.className} text-sm font-extrabold`} style={{ color: i === 1 ? CYAN : NEON }}>
                  0{i + 1}
                </span>
                <h3 className="mt-2 font-display text-base font-bold text-white">{step.title}</h3>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-ink-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-4xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-[#00FF87]/25 bg-gradient-to-br from-[#0f1a16] via-[#0d1117] to-[#0b1619] p-8 text-center sm:p-14">
            <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-56 w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,135,0.2),transparent)] blur-xl" />
            <h2 className="relative font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">The next runner launches in minutes.</h2>
            <p className="relative mx-auto mt-3 max-w-xl font-body text-sm text-ink-600 sm:text-base">Be in the terminal when it does.</p>
            <LandingCta label="Go Trade" variant="neon" className="relative mt-8" />
            <p className="relative mx-auto mt-8 max-w-xl font-body text-[0.7rem] leading-relaxed text-ink-400">
              Crypto is highly volatile and most new coins lose most or all of their value. Kamby never holds your funds; only trade what you can
              afford to lose.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

const STATS = [
  { value: '3', label: 'Chains', accent: NEON },
  { value: '1', label: 'USDC balance', accent: CYAN },
  { value: '$0', label: 'Gas to buy', accent: NEON },
  { value: '1-tap', label: 'Buy & sell', accent: CYAN },
];

const FEATURES = [
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
  { title: 'Go trade', body: 'Pick a coin from Trending, Trenches or XXXRisk and buy it in one tap.' },
];
