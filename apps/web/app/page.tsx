import type { Metadata } from 'next';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { LandingCta } from '@/components/landing/LandingCta';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

export const metadata: Metadata = {
  title: 'Kamby — trade every new coin with just USDC',
  description:
    'Trade coins from Pump.fun, LetsBonk, Clanker, four.meme and every major DEX on Solana, Base and BNB Chain — with one USDC balance, one tap, and no gas to think about.',
};

/**
 * The landing page (2026-10-04): new visitors see this, not the terminal — signing in takes
 * them to /terminal. Fully static (no API calls), so it's the fastest page on the site.
 */
export default function LandingPage() {
  return (
    <div className="kamby-void kamby-landing min-h-screen overflow-x-hidden bg-bg text-ink-900">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_50%_at_50%_0%,rgb(var(--kamby-accent)/0.18),transparent_70%)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <KambyLogo />
        </div>
        <LandingCta label="Sign in" variant="ghost" className="px-4 py-2" />
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-5 pb-16 pt-14 text-center sm:pt-24">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 font-mono text-[0.7rem] uppercase tracking-wider text-ink-600 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-up" /> Live on Solana · Base · BNB Chain
          </p>
          <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Catch every new coin.
            <br />
            <span className="bg-gradient-to-r from-[#22D3EE] via-[#3B82F6] to-[#7C3AED] bg-clip-text text-transparent">Trade it in one tap.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-body text-base text-ink-600 sm:text-lg">
            Launches from Pump.fun, LetsBonk, Clanker, four.meme and every major DEX — in one terminal, with one USDC balance. No
            wallet app, no seed phrase, no gas to think about.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LandingCta className="w-full sm:w-auto" />
            <a href="#how" className="font-body text-sm font-semibold text-ink-600 hover:text-ink-900">
              How it works →
            </a>
          </div>
          <p className="mt-4 font-body text-xs text-ink-400">Sign in with email or Google · free to join</p>
        </section>

        {/* Chains */}
        <section className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3 px-5 pb-16">
          {(
            [
              ['solana', 'Solana'],
              ['base', 'Base'],
              ['bnb', 'BNB Chain'],
            ] as [BadgeChain, string][]
          ).map(([chain, name]) => (
            <span key={chain} className="flex items-center gap-2.5 rounded-full border border-line bg-surface/70 px-4 py-2 font-display text-sm font-semibold">
              <span className="relative h-5 w-5">
                <ChainBadge chain={chain} className="!static !h-5 !w-5 !ring-0" />
              </span>
              {name}
            </span>
          ))}
        </section>

        {/* Features */}
        <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface/70 p-5 transition-colors hover:border-accent/50">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 font-display text-base text-accent">{f.icon}</div>
              <h3 className="mt-4 font-display text-base font-bold">{f.title}</h3>
              <p className="mt-1.5 font-body text-sm leading-relaxed text-ink-600">{f.body}</p>
            </div>
          ))}
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-5xl scroll-mt-10 px-5 pb-20">
          <h2 className="text-center font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Start trading in under a minute</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-line bg-surface/70 p-5">
                <span className="font-mono text-xs font-semibold text-accent">0{i + 1}</span>
                <h3 className="mt-2 font-display text-base font-bold">{step.title}</h3>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-ink-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Fees */}
        <section className="mx-auto max-w-3xl px-5 pb-20 text-center">
          <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Simple fees. Gas on us.</h2>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              ['2%', 'under $100'],
              ['1%', '$100 – $499'],
              ['0.75%', '$500 and up'],
            ].map(([fee, size]) => (
              <div key={fee} className="rounded-2xl border border-line bg-surface/70 px-3 py-5">
                <div className="font-display text-2xl font-extrabold text-ink-900">{fee}</div>
                <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-wide text-ink-400">{size}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 font-body text-xs text-ink-400">
            Per trade. Network fees are covered by Kamby. First buy of a new Solana coin includes a small one-time setup (~$0.30).
          </p>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-4xl px-5 pb-24">
          <div className="rounded-3xl border border-line bg-gradient-to-br from-surface to-surface-raised p-8 text-center sm:p-12">
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">The next runner launches in minutes.</h2>
            <p className="mx-auto mt-3 max-w-xl font-body text-sm text-ink-600">Be in the terminal when it does.</p>
            <LandingCta className="mt-6" />
            <p className="mx-auto mt-6 max-w-xl font-body text-[0.7rem] leading-relaxed text-ink-400">
              Crypto is highly volatile and most new coins lose most or all of their value. Kamby never holds your funds; only trade
              what you can afford to lose.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

const FEATURES = [
  { icon: '⚡', title: 'Every launchpad, live', body: 'New coins stream in the second they launch — Pump.fun, LetsBonk, Meteora, Clanker, four.meme and more.' },
  { icon: '$', title: 'One USDC balance', body: 'Deposit USDC on any chain, or buy with Apple Pay, Google Pay or card. That’s the only asset you ever need.' },
  { icon: '⛽', title: 'Gas covered', body: 'Kamby pays the network fees. No ETH, BNB or SOL to buy first, no failed trades for missing gas.' },
  { icon: '☝', title: 'One-tap trading', body: 'Buy and sell instantly with Auto slippage — no review screens slowing you down.' },
  { icon: '📈', title: 'Live charts', body: 'Real-time price lines and candles on every coin, from first trade to graduation.' },
  { icon: '🛡', title: 'Safety checks built in', body: 'Honeypot, tax and authority checks filter the worst before a coin ever reaches you. Rug flags on the riskiest.' },
];

const STEPS = [
  { title: 'Sign in', body: 'Email or Google. Your wallet is created for you — no extension, no seed phrase.' },
  { title: 'Add USDC', body: 'Send USDC on Solana, Base or BNB Chain, or buy it with Apple Pay, Google Pay or card.' },
  { title: 'Trade', body: 'Pick a coin from Trending, Trenches or XXXRisk and buy it in one tap.' },
];
