import type { XxxRiskColumn, XxxRiskToken } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';
import { cn } from '@kamby/ui';
import { Zap } from 'lucide-react';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { HeroDevices } from './HeroDevices';

const COLUMNS: { id: XxxRiskColumn; key: 'colNew' | 'colSoon' | 'colMigrated'; ring: string }[] = [
  { id: 'new', key: 'colNew', ring: '#00FF87' },
  { id: 'soon', key: 'colSoon', ring: '#FBBF24' },
  { id: 'migrated', key: 'colMigrated', ring: '#8B9BFF' },
];
const CHAIN_DOT: Record<string, string> = {
  solana: 'linear-gradient(135deg,#9945FF,#14F195)',
  'eip155:8453': '#0052FF',
  'eip155:56': '#F3BA2F',
  'eip155:4663': '#CCFF00',
};

function usd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
const sym = (t: XxxRiskToken) => (t.symbol ?? '').replace(/^\$+/, '');

/** A calm, rising price line for the phone's chart — drawn from the coin's address, so it's stable. */
function chartPath(seed: string, w: number, h: number): { line: string; area: string } {
  let v = 0;
  for (const ch of seed) v = (v * 31 + ch.charCodeAt(0)) % 9973;
  const pts: [number, number][] = [];
  let y = h * 0.88;
  for (let i = 0; i <= 28; i++) {
    v = (v * 1103 + 12345) % 9973;
    y += ((v / 9973) - 0.66) * h * 0.16;
    y = Math.max(h * 0.12, Math.min(h * 0.9, y));
    pts.push([(i / 28) * w, y]);
  }
  const line = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

/**
 * The landing page's first screen picture (2026-11-02, owner: "a terminal for PC and an iPhone
 * screen — aesthetic, try your best"): a monitor showing the real Hunt board and an iPhone in front
 * showing a real coin, both filled from the live feed. On phones only the iPhone shows. Falls back
 * to the older device picture when the feed has nothing.
 */
export async function HeroShowcase({ tokens }: { tokens: XxxRiskToken[] }) {
  const t = await getTranslations('xxxrisk');
  const pick = (col: XxxRiskColumn) => tokens.filter((x) => (x.column ?? 'new') === col && x.imageUrl && x.symbol).slice(0, 6);
  const cols = COLUMNS.map((c) => ({ ...c, rows: pick(c.id) }));
  if (cols.every((c) => c.rows.length < 3)) return <HeroDevices />;
  // The phone shows a busy, believable coin: the most holders among $50K–$20M caps (a billion-dollar
  // 'new' coin is a copycat with fake numbers — never the poster child).
  const pool = tokens.filter((x) => x.imageUrl && x.symbol && x.marketCapUsd >= 50_000 && x.marketCapUsd <= 20_000_000);
  const star = [...(pool.length ? pool : tokens.filter((x) => x.imageUrl && x.symbol))].sort((a, b) => (b.holders ?? 0) - (a.holders ?? 0))[0]!;
  const chart = chartPath(star.mintAddress, 220, 110);

  return (
    <div className="relative mx-auto w-full max-w-6xl">
      {/* The monitor (computers). */}
      <div className="relative hidden lg:block lg:pr-[11%]">
        <div className="rounded-[1.5rem] border border-white/10 bg-gradient-to-b from-[#1B1E23] to-[#0E1013] p-[10px] shadow-[0_60px_140px_-40px_rgba(0,0,0,0.95)]">
          <div className="overflow-hidden rounded-[0.95rem] border border-black bg-[#07090C]">
            {/* App bar */}
            <div className="flex h-10 items-center gap-4 border-b border-white/[0.07] px-4">
              <span className="flex items-center gap-1.5 font-display text-[0.78rem] font-black tracking-wide text-white">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-[#00FF87] text-[0.55rem] text-black">K</span>
                KAMBY
              </span>
              <span className="font-display text-[0.7rem] font-bold text-[#00FF87]">Hunt</span>
              <span className="font-display text-[0.7rem] font-semibold text-white/45">Explore</span>
              <span className="font-display text-[0.7rem] font-semibold text-white/45">Track</span>
              <span className="font-display text-[0.7rem] font-semibold text-white/45">Live</span>
              <span className="font-display text-[0.7rem] font-semibold text-white/45">Portfolio</span>
              <span className="ml-auto h-5 w-40 rounded-full border border-white/10 bg-white/[0.03]" />
              <span className="rounded-full bg-[#00FF87] px-2.5 py-0.5 font-display text-[0.62rem] font-bold text-black">Deposit</span>
              <span className="h-5 w-5 rounded-full border border-white/10 bg-white/[0.05]" />
            </div>
            {/* Three live columns */}
            <div className="grid grid-cols-3">
              {cols.map((c) => (
                <section key={c.id} className="border-r border-white/[0.07] last:border-r-0">
                  <header className="flex h-8 items-center gap-1.5 border-b border-white/[0.07] bg-white/[0.015] px-3">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.ring }} aria-hidden />
                    <span className="font-display text-[0.68rem] font-extrabold text-white">{t(c.key)}</span>
                    <span className="ml-auto h-4 w-16 rounded border border-white/[0.07]" />
                  </header>
                  <ul>
                    {c.rows.map((x) => {
                      const curve = Math.max(0, Math.min(100, c.id === 'migrated' ? 100 : (x.curvePct ?? 0)));
                      const top = x.topHoldersPct ?? null;
                      return (
                        <li key={x.mintAddress} className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-2 last:border-b-0">
                          <span className="relative shrink-0 rounded-[6px] p-[1.5px]" style={{ background: `conic-gradient(${c.ring} ${curve * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}>
                            <TokenAvatar src={x.imageUrl} seed={x.mintAddress} label={x.symbol} className="!rounded-[4px] h-8 w-8 border-[1.5px] border-[#07090C] text-[0.6rem]" />
                            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-[#07090C]" style={{ background: CHAIN_DOT[x.chainIdentifier ?? 'solana'] ?? CHAIN_DOT.solana }} aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-display text-[0.7rem] font-extrabold text-white">${sym(x)}</span>
                            {top !== null && (
                              <span className={cn('mt-0.5 inline-block rounded-full border px-1 font-mono text-[0.5rem] font-bold', top > 50 ? 'border-[#FF4D6A]/35 text-[#FF4D6A]' : 'border-white/[0.08] text-[#00E68A]')}>
                                T10 {Math.round(top)}%
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <span className="font-mono text-[0.62rem] font-bold text-white">{usd(x.marketCapUsd)}</span>
                            <span className="flex items-center gap-0.5 rounded-full bg-[#00FF87] px-1.5 font-mono text-[0.5rem] font-bold text-black">
                              <Zap className="h-2 w-2" fill="currentColor" aria-hidden />$5
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            {/* Status strip */}
            <div className="flex h-7 items-center gap-4 border-t border-white/[0.07] px-4 font-mono text-[0.55rem] text-white/40">
              <span>Holdings</span>
              <span>Trades</span>
              <span>Watchlist</span>
              <span className="ml-auto flex items-center gap-1 text-[#00FF87]">
                <span className="h-1 w-1 rounded-full bg-[#00FF87]" aria-hidden />
                LIVE
              </span>
            </div>
          </div>
        </div>
        {/* Stand */}
        <div aria-hidden className="mx-auto h-10 w-28 bg-gradient-to-b from-[#16181C] to-[#0C0D10] [clip-path:polygon(18%_0,82%_0,100%_100%,0_100%)]" />
        <div aria-hidden className="mx-auto h-2.5 w-64 rounded-full bg-gradient-to-b from-[#1B1E23] to-[#0C0D10]" />
      </div>

      {/* The iPhone — in front on computers, alone and centred on phones. */}
      <div className="kl-float relative mx-auto w-[260px] lg:absolute lg:bottom-[-2.5rem] lg:right-0 lg:mx-0">
        <span aria-hidden className="absolute -left-[3px] top-24 h-8 w-[3px] rounded-l bg-[#2A2D33]" />
        <span aria-hidden className="absolute -left-[3px] top-36 h-12 w-[3px] rounded-l bg-[#2A2D33]" />
        <span aria-hidden className="absolute -right-[3px] top-32 h-16 w-[3px] rounded-r bg-[#2A2D33]" />
        <div className="rounded-[2.9rem] border-[3px] border-[#2A2D33] bg-[#0B0C0F] p-[9px] shadow-[0_50px_120px_-30px_rgba(0,0,0,0.95)]">
          <div className="relative h-[530px] overflow-hidden rounded-[2.35rem] bg-[#050607]">
            <span aria-hidden className="absolute left-1/2 top-2.5 z-10 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-black" />
            <div className="flex h-11 items-end justify-between px-6 pb-1 font-display text-[0.65rem] font-bold text-white">
              <span>9:41</span>
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-2 w-3 rounded-[2px] border border-white/80" />
              </span>
            </div>
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2.5">
                <TokenAvatar src={star.imageUrl} seed={star.mintAddress} label={star.symbol} className="h-10 w-10 rounded-full text-xs" />
                <span className="min-w-0">
                  <span className="block truncate font-display text-[0.95rem] font-black text-white">${sym(star)}</span>
                  <span className="block truncate font-body text-[0.65rem] text-white/45">{star.name}</span>
                </span>
              </div>
              <div className="mt-4 font-mono text-[1.65rem] font-bold leading-none tracking-tight text-white">{usd(star.marketCapUsd)}</div>
              <div className="mt-1 font-body text-[0.65rem] text-white/45">{t('mc')}</div>
              <svg viewBox="0 0 220 110" className="mt-3 h-[110px] w-full" aria-hidden>
                <defs>
                  <linearGradient id="kl-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#00FF87" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#00FF87" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={chart.area} fill="url(#kl-area)" />
                <path d={chart.line} fill="none" stroke="#00FF87" strokeWidth="2" strokeLinejoin="round" />
              </svg>
              <div className="mt-2 flex gap-1 font-mono text-[0.55rem] font-semibold text-white/40">
                {['1m', '5m', '1H', '4H', '1D'].map((x) => (
                  <span key={x} className={cn('rounded-md px-2 py-1', x === '1H' && 'bg-white/[0.08] text-white')}>
                    {x}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {[
                  ['Holders', star.holders != null ? String(star.holders) : '—'],
                  ['Top 10', star.topHoldersPct != null ? `${Math.round(star.topHoldersPct)}%` : '—'],
                  ['Liq', usd(star.liquidityUsd)],
                ].map(([k, v]) => (
                  <span key={k} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    <span className="block font-body text-[0.5rem] text-white/40">{k}</span>
                    <span className="block font-mono text-[0.66rem] font-bold text-white">{v}</span>
                  </span>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {['$5', '$10', '$25', '$50'].map((x) => (
                  <span key={x} className={cn('rounded-lg border py-1.5 text-center font-mono text-[0.62rem] font-bold', x === '$5' ? 'border-[#00FF87]/50 text-[#00FF87]' : 'border-white/[0.08] text-white/70')}>
                    {x}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <span className="rounded-2xl bg-[#00FF87] py-2.5 text-center font-display text-[0.8rem] font-black text-black">Buy</span>
                <span className="rounded-2xl border border-[#FF4D6A]/40 px-5 py-2.5 text-center font-display text-[0.8rem] font-black text-[#FF4D6A]">Sell</span>
              </div>
            </div>
            {/* Tab bar */}
            <div className="absolute inset-x-3 bottom-3 flex h-11 items-center justify-around rounded-full border border-white/[0.08] bg-[#111317] px-2">
              <span className="rounded-full bg-[#00FF87] px-3 py-1 font-display text-[0.6rem] font-black text-black">Hunt</span>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-3.5 w-3.5 rounded-full border-[1.5px] border-white/35" aria-hidden />
              ))}
            </div>
            <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-white/40" />
          </div>
        </div>
      </div>
    </div>
  );
}
