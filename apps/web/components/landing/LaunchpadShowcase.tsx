import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { XxxRiskToken } from '@kamby/domain';
import { Newspaper, Rocket, Target, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChainBadge, badgeChainFor } from '@/components/market/ChainBadge';
import { launchpadInfo } from '@/components/discovery/feeds/xxxrisk-filters';
import { formatCompactUsd } from '@/lib/format';

/** The launchpads shown on the page, with the chain each launches on. */
const PADS: { id: string; chain: string }[] = [
  { id: 'pump.fun', chain: 'solana' },
  { id: 'letsbonk.fun', chain: 'solana' },
  { id: 'raydium-launchlab', chain: 'solana' },
  { id: 'met-dbc', chain: 'solana' },
  { id: 'bags.fun', chain: 'solana' },
  { id: 'moonshot', chain: 'solana' },
  { id: 'memefun', chain: 'solana' },
  { id: 'jup-studio', chain: 'solana' },
  { id: 'four.meme', chain: 'eip155:56' },
  { id: 'flap', chain: 'eip155:56' },
  { id: 'clanker', chain: 'eip155:8453' },
  { id: 'pons', chain: 'eip155:4663' },
];

/**
 * "Every launchpad. Every chain." (2026-11-01): the launchpad board in one look — the real count
 * of coins on it right now, the launchpads it pulls from, and the filter panel as a still picture
 * (its labels only — no made-up numbers). 2026-11-01 later: the top real coins on the board peek
 * out from behind it.
 */
export async function LaunchpadShowcase({ tokens }: { tokens: XxxRiskToken[] }) {
  const t = await getTranslations('landing');
  const tx = await getTranslations('xxxrisk');
  const pads = new Set(tokens.map((x) => x.launchpad ?? 'pump.fun')).size;
  const chains = new Set(tokens.map((x) => x.chainIdentifier ?? 'solana')).size;
  const ranges = ['fR_curve', 'fR_mc', 'fR_dev', 'fR_snipers'] as const;
  // Real coins from the board right now, the biggest first, as the panel's "results".
  const top = [...tokens].filter((x) => x.symbol && x.imageUrl).sort((a, b) => b.marketCapUsd - a.marketCapUsd).slice(0, 4);
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
      <div>
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#5BE3A0]">{t('lpKicker')}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-[1.05] tracking-tight text-white">{t('lpTitle')}</h2>
        <p className="mt-4 max-w-lg font-body text-base leading-relaxed text-[#94A3B8]">{t('lpBody')}</p>
        {tokens.length > 0 && (
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#00FF87]/25 bg-[#00FF87]/[0.06] px-3.5 py-1.5 font-mono text-xs font-bold text-[#00FF87]">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FF87]" />
            {t('lpLive', { coins: tokens.length, pads, chains })}
          </p>
        )}
        <ul className="mt-7 flex flex-wrap gap-2">
          {PADS.map((p) => {
            const info = launchpadInfo(p.id);
            const chain = badgeChainFor(p.chain);
            return (
              <li key={p.id} className="flex h-9 items-center gap-2 rounded-full border px-3 font-display text-[0.8rem] font-bold text-white" style={{ borderColor: `${info.color}55`, backgroundColor: `${info.color}10` }}>
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-black text-black" style={{ backgroundColor: info.color }}>
                  {info.mark}
                </span>
                {info.name}
                {chain && <ChainBadge chain={chain} className="!static !h-3.5 !w-3.5 !ring-0" />}
              </li>
            );
          })}
        </ul>
      </div>

      {/* The filter panel, as a picture, with the board's real top coins behind it. */}
      <div aria-hidden className="relative lg:pl-28">
        {top.length > 0 && (
          <div className="absolute left-0 top-12 hidden w-60 -rotate-[4deg] flex-col gap-2.5 lg:flex">
            {top.map((x) => {
              const info = launchpadInfo(x.launchpad ?? 'pump.fun');
              return (
                <div key={x.mintAddress} className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-[#0D1016] p-2.5 shadow-xl shadow-black/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={x.imageUrl!} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-bold text-white">${x.symbol}</span>
                    <span className="mt-0.5 flex items-center gap-1 font-mono text-[0.65rem] text-white/45">
                      <span className="flex h-3 w-3 items-center justify-center rounded-full text-[0.45rem] font-black text-black" style={{ backgroundColor: info.color }}>
                        {info.mark}
                      </span>
                      MC {formatCompactUsd(x.marketCapUsd)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      <div className="relative rounded-[1.75rem] border border-white/[0.08] bg-[#0A0C11] p-5 shadow-2xl shadow-black/70">
        <div className="flex items-center justify-between">
          <p className="font-display text-base font-bold text-white">{tx('filters')}</p>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-white/50">×</span>
        </div>
        <div className="mt-4 flex gap-5 border-b border-white/[0.06] font-display text-sm font-bold">
          <span className="relative pb-2.5 text-white after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#00FF87]">{tx('colNew')}</span>
          <span className="pb-2.5 text-white/40">{tx('colSoon')}</span>
          <span className="pb-2.5 text-white/40">{tx('colMigrated')}</span>
        </div>
        <p className="mt-4 font-display text-xs font-bold text-white/70">{tx('fLaunchpads')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PADS.slice(0, 6).map((p) => {
            const info = launchpadInfo(p.id);
            return (
              <span key={p.id} className="flex h-7 items-center gap-1.5 rounded-full border px-2 font-display text-[0.7rem] font-bold text-white" style={{ borderColor: `${info.color}55`, backgroundColor: `${info.color}12` }}>
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[0.5rem] font-black text-black" style={{ backgroundColor: info.color }}>
                  {info.mark}
                </span>
                {info.name}
              </span>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 font-body text-[0.78rem] text-white">
          {(['fT_hasX', 'fT_devUnder20', 'fT_hideMint', 'fT_auditedOnly'] as const).map((k, i) => (
            <span key={k} className="flex items-center gap-2">
              <span className={i % 3 === 0 ? 'flex h-4 w-4 items-center justify-center rounded-[4px] bg-[#00FF87] text-[0.6rem] font-black text-black' : 'h-4 w-4 rounded-[4px] border border-white/25'}>{i % 3 === 0 ? '✓' : ''}</span>
              {tx(k)}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-4">
          {ranges.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2">
              <span className="font-body text-[0.78rem] text-white/60">{tx(k)}</span>
              <span className="h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-display text-[0.7rem] font-semibold text-white/35">{tx('fMin')}</span>
              <span className="h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-display text-[0.7rem] font-semibold text-white/35">{tx('fMax')}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <span className="flex h-11 items-center justify-center rounded-2xl bg-white/[0.06] font-display text-sm font-bold text-white/70">{tx('reset')}</span>
          <span className="flex h-11 items-center justify-center rounded-2xl bg-[#00FF87] font-display text-sm font-black text-black">{tx('show', { n: tokens.length || 100 })}</span>
        </div>
      </div>
      </div>
    </div>
  );
}

/** "More than a terminal" (2026-11-01): the parts of Kamby beyond trading, one tile each. */
export async function MoreOnKamby() {
  const t = await getTranslations('landing');
  const tP = await getTranslations('perps');
  const art: ReactNode[] = [<PredictArt key="p" />, <NewsArt key="n" />, <LaunchArt key="l" />, <PerpsArt key="x" long={tP('long')} short={tP('short')} />];
  const tiles = [
    { href: '/predictions', icon: <Target />, title: t('m1t'), body: t('m1b'), color: '#38BDF8' },
    { href: '/news', icon: <Newspaper />, title: t('m2t'), body: t('m2b'), color: '#FACC15' },
    { href: '/launch', icon: <Rocket />, title: t('m3t'), body: t('m3b'), color: '#FF66C4' },
    { href: '/perps', icon: <Zap />, title: t('m4t'), body: t('m4b'), color: '#00FF87' },
  ];
  return (
    <div>
      <div className="text-center">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#5BE3A0]">{t('moreKicker')}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-tight tracking-tight text-white">{t('moreTitle')}</h2>
      </div>
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <Link key={x.href} href={x.href} className="group flex flex-col gap-3 rounded-[1.5rem] border border-white/[0.07] bg-white/[0.02] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.04]">
            <div aria-hidden className="mb-1 h-28 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#07090D] p-3" style={{ backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${x.color}14, transparent 60%)` }}>
              {art[i]}
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl [&>svg]:h-5 [&>svg]:w-5" style={{ backgroundColor: `${x.color}14`, color: x.color }}>
              {x.icon}
            </span>
            <span className="font-display text-lg font-bold text-white">{x.title}</span>
            <span className="font-body text-sm leading-relaxed text-[#94A3B8]">{x.body}</span>
            <span className="mt-auto font-display text-sm font-bold text-white/60 transition-colors group-hover:text-white">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Tile pictures: decorative, no numbers that could read as stats. */
function PredictArt() {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F7931A] font-display text-[0.6rem] font-black text-black">₿</span>
        <span className="h-2 w-24 rounded-full bg-white/20" />
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        <span className="w-[62%] bg-[#00FF87]" />
        <span className="flex-1 bg-[#FF3B5C]/80" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="flex h-7 items-center justify-center rounded-lg bg-[#00FF87]/15 font-display text-sm font-black text-[#00FF87]">▲</span>
        <span className="flex h-7 items-center justify-center rounded-lg bg-[#FF3B5C]/15 font-display text-sm font-black text-[#FF3B5C]">▼</span>
      </div>
    </div>
  );
}

function NewsArt() {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-full bg-[#FACC15]/80" />
        <span className="h-1.5 w-14 rounded-full bg-white/25" />
      </div>
      <span className="h-2 w-full rounded-full bg-white/50" />
      <span className="h-2 w-4/5 rounded-full bg-white/50" />
      <span className="h-1.5 w-3/5 rounded-full bg-white/15" />
      <div className="mt-auto flex gap-1.5">
        <span className="rounded-full border border-[#00FF87]/40 bg-[#00FF87]/10 px-2 py-0.5 font-display text-[0.6rem] font-bold text-[#00FF87]">$BTC ▲</span>
        <span className="rounded-full border border-white/15 px-2 py-0.5 font-display text-[0.6rem] font-bold text-white/60">$ETH</span>
      </div>
    </div>
  );
}

function LaunchArt() {
  return (
    <div className="flex h-full items-center gap-3">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-[#FF66C4]/50 bg-[#FF66C4]/[0.07] text-2xl">🚀</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="font-display text-sm font-black text-white">$YOURS</span>
        <span className="h-1.5 w-4/5 rounded-full bg-white/15" />
        <div className="flex gap-1">
          {['pump.fun', 'clanker', 'four.meme'].map((id) => {
            const info = launchpadInfo(id);
            return (
              <span key={id} className="flex h-5 w-5 items-center justify-center rounded-full text-[0.55rem] font-black text-black" style={{ backgroundColor: info.color }}>
                {info.mark}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PerpsArt({ long, short }: { long: string; short: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <svg viewBox="0 0 120 34" className="h-9 w-full" preserveAspectRatio="none">
        <polyline points="0,28 14,24 26,26 40,17 54,20 68,11 82,14 96,6 120,3" fill="none" stroke="#00FF87" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="relative h-1.5 rounded-full bg-white/10">
        <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-[#00FF87]" />
        <span className="absolute left-[40%] top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#00FF87] bg-[#07090D]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="flex h-7 items-center justify-center rounded-lg bg-[#00FF87] font-display text-xs font-black text-black">{long}</span>
        <span className="flex h-7 items-center justify-center rounded-lg bg-[#FF3B5C]/15 font-display text-xs font-black text-[#FF3B5C]">{short}</span>
      </div>
    </div>
  );
}
