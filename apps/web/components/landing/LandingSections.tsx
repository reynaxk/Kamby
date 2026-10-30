import { getTranslations } from 'next-intl/server';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

const CHAINS: { id: BadgeChain; name: string }[] = [
  { id: 'solana', name: 'Solana' },
  { id: 'base', name: 'Base' },
  { id: 'bnb', name: 'BNB Chain' },
  { id: 'robinhood', name: 'Robinhood Chain' },
];

/** The chains, big and plain, under the hero (2026-10-29). */
export async function ChainStrip() {
  const t = await getTranslations('landing');
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-5">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.3em] text-white/55">{t('worksOn')}</p>
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {CHAINS.map((c) => (
          <div key={c.id} className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5">
            <ChainBadge chain={c.id} className="!static !h-7 !w-7 !ring-0" />
            <span className="whitespace-nowrap font-display text-sm font-bold text-white">{c.name}</span>
            <span className="hidden whitespace-nowrap rounded-md bg-[#00FF87]/10 px-1.5 py-0.5 font-mono text-[0.6rem] font-bold text-[#00FF87] lg:inline">{t('gasZero')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "How it works" — three steps, each with its own small picture (2026-10-29). */
export async function HowItWorks() {
  const t = await getTranslations('landing');
  const steps = [
    {
      n: '01',
      title: t('step1Title'),
      body: t('step1Body'),
      art: (
        <div className="space-y-2">
          <div className="flex h-10 items-center rounded-xl border border-white/10 bg-black/30 px-3 font-body text-sm text-white/45">you@email.com</div>
          <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-white font-display text-sm font-bold text-black">
            <span className="font-black text-[#4285F4]">G</span> Google
          </div>
        </div>
      ),
    },
    {
      n: '02',
      title: t('step2Title'),
      body: t('step2Body'),
      art: (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="font-body text-[0.68rem] text-white/45">USDC</p>
          <p className="font-display text-2xl font-black tabular-nums text-white">
            $100<span className="text-white/40">.00</span>
          </p>
          <div className="mt-2 flex gap-1">
            {CHAINS.map((c) => (
              <ChainBadge key={c.id} chain={c.id} className="!static !h-5 !w-5 !ring-0" />
            ))}
          </div>
        </div>
      ),
    },
    {
      n: '03',
      title: t('step3Title'),
      body: t('step3Body'),
      art: (
        <div className="flex items-center gap-2">
          <span className="flex h-12 flex-1 items-center justify-center rounded-xl bg-[#00FF87] font-display text-sm font-black text-black">Buy</span>
          <span className="flex h-12 items-center rounded-xl border border-[#00FF87]/50 bg-[#00FF87]/10 px-3 font-display text-sm font-extrabold text-[#00FF87]">⚡ $5</span>
        </div>
      ),
    },
  ];
  return (
    <div>
      <div className="text-center">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#5BE3A0]">{t('howKicker')}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-tight tracking-tight text-white">{t('howTitle')}</h2>
        <p className="mx-auto mt-3 max-w-xl font-body text-base text-[#94A3B8]">{t('howSub')}</p>
      </div>
      <ol className="relative mt-12 grid gap-4 md:grid-cols-3">
        {/* the line that joins the steps */}
        <span aria-hidden className="absolute left-[16%] right-[16%] top-[2.1rem] hidden border-t border-dashed border-[#00FF87]/25 md:block" />
        {steps.map((s) => (
          <li key={s.n} className="relative flex flex-col rounded-[1.75rem] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01)_60%)] p-6">
            <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#00FF87]/30 bg-[#030305] font-display text-sm font-black text-[#00FF87]">{s.n}</span>
            <h3 className="mt-5 font-display text-xl font-bold tracking-tight text-white">{s.title}</h3>
            <p className="mt-2 flex-1 font-body text-sm leading-relaxed text-[#94A3B8]">{s.body}</p>
            <div className="mt-6">{s.art}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Straight answers to the first questions people have (2026-10-29). */
export async function LandingFaq() {
  const t = await getTranslations('landing');
  const qs = [1, 3, 5].map((n) => ({ q: t(`q${n}`), a: t(`a${n}`) }));
  return (
    <div>
      <h2 className="text-center font-display text-[clamp(2rem,5vw,3rem)] font-black tracking-tight text-white">{t('faqTitle')}</h2>
      <div className="mt-10 divide-y divide-white/[0.07] rounded-[1.75rem] border border-white/[0.08] bg-white/[0.02]">
        {qs.map((x, n) => (
          <details key={n} className="group px-6 py-5" open={n === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-bold text-white [&::-webkit-details-marker]:hidden">
              {x.q}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[#00FF87] transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-[#94A3B8]">{x.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

/** "Under the hood" — what Kamby does inside when you tap Buy, step by step (2026-10-29, owner:
 *  "you don't tell how Kamby works inside"). High-level only: no fee numbers, no internals. */
export async function UnderTheHood() {
  const t = await getTranslations('landing');
  const steps = [
    { icon: '⚡', title: t('h1t'), body: t('h1b') },
    { icon: '🔎', title: t('h2t'), body: t('h2b') },
    { icon: '🛡️', title: t('h3t'), body: t('h3b') },
    { icon: '🔑', title: t('h4t'), body: t('h4b') },
    { icon: '⛽', title: t('h5t'), body: t('h5b') },
  ];
  return (
    <div>
      <div className="text-center">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#5BE3A0]">{t('hoodKicker')}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-tight tracking-tight text-white">{t('hoodTitle')}</h2>
        <p className="mx-auto mt-3 max-w-xl font-body text-base text-[#94A3B8]">{t('hoodSub')}</p>
      </div>
      <ol className="relative mt-12 grid gap-3 lg:grid-cols-5">
        <span aria-hidden className="kh-wire absolute bottom-8 left-[1.45rem] top-8 w-px lg:bottom-auto lg:left-[10%] lg:right-[10%] lg:top-[1.45rem] lg:h-px lg:w-auto" />
        {steps.map((s, n) => (
          <li key={n} className="relative flex gap-4 lg:flex-col lg:items-center lg:gap-0 lg:text-center">
            <span className="kh-node relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#08090E] text-xl" style={{ animationDelay: `${n * 1.1}s` }}>
              {s.icon}
            </span>
            <span className="pb-4 lg:mt-5 lg:pb-0">
              <span className="block font-mono text-[0.65rem] font-bold text-[#00FF87]">0{n + 1}</span>
              <span className="mt-1 block font-display text-base font-bold text-white">{s.title}</span>
              <span className="mt-1.5 block font-body text-sm leading-relaxed text-[#94A3B8]">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
