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
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/**
 * The hero's product shot (2026-11-02, owner: Axiom-style landing): the real Hunt board as it is
 * right now — the newest coins with a picture in each column, the same rows as /hunt. Falls back
 * to the device mock-up while the feed has nothing.
 */
export async function HeroBoard({ tokens }: { tokens: XxxRiskToken[] }) {
  const t = await getTranslations('xxxrisk');
  const pick = (col: XxxRiskColumn) => tokens.filter((x) => (x.column ?? 'new') === col && x.imageUrl && x.symbol).slice(0, 5);
  const cols = COLUMNS.map((c) => ({ ...c, rows: pick(c.id) }));
  if (cols.every((c) => c.rows.length < 3)) return <HeroDevices />;

  return (
    <div className="relative mx-auto w-full max-w-6xl">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#07090C] shadow-[0_50px_140px_-30px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.04] ring-offset-8 ring-offset-[#040506]">
        <div className="flex h-10 items-center gap-4 border-b border-white/[0.07] px-4 font-display text-xs font-bold text-white/40">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          </span>
          <span className="text-[#00FF87]">Hunt</span>
          <span className="hidden sm:inline">Explore</span>
          <span className="hidden sm:inline">Track</span>
          <span className="hidden sm:inline">Portfolio</span>
          <span className="ml-auto flex items-center gap-1.5 font-mono font-semibold text-[#00FF87]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FF87]" aria-hidden />
            LIVE
          </span>
        </div>
        <div className="grid sm:grid-cols-3">
          {cols.map((c, ci) => (
            <section key={c.id} className={cn('border-white/[0.07] sm:border-r sm:last:border-r-0', ci > 0 && 'hidden sm:block')}>
              <header className="flex h-9 items-center gap-2 border-b border-white/[0.07] bg-white/[0.015] px-3">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.ring }} aria-hidden />
                <span className="font-display text-[0.8rem] font-extrabold text-white">{t(c.key)}</span>
              </header>
              <ul>
                {c.rows.map((x) => {
                  const curve = Math.max(0, Math.min(100, c.id === 'migrated' ? 100 : (x.curvePct ?? 0)));
                  const top = x.topHoldersPct ?? null;
                  const dev = x.devPct ?? null;
                  return (
                    <li key={x.mintAddress} className="flex items-center gap-2.5 border-b border-white/[0.04] px-3 py-2.5 last:border-b-0">
                      <span className="relative shrink-0 rounded-md p-[2px]" style={{ background: `conic-gradient(${c.ring} ${curve * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}>
                        <TokenAvatar src={x.imageUrl} seed={x.mintAddress} label={x.symbol} className="!rounded-[5px] h-11 w-11 border-2 border-[#07090C] text-sm" />
                        <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#07090C]" style={{ background: CHAIN_DOT[x.chainIdentifier ?? 'solana'] ?? CHAIN_DOT.solana }} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[0.85rem] font-extrabold text-white">${x.symbol!.replace(/^\$+/, '')}</span>
                        <span className="mt-1 flex gap-1">
                          {top !== null && (
                            <span className={cn('rounded-full border px-1.5 font-mono text-[0.58rem] font-bold', top > 50 ? 'border-[#FF4D6A]/35 text-[#FF4D6A]' : 'border-white/[0.08] text-[#00E68A]')}>
                              T10 {Math.round(top)}%
                            </span>
                          )}
                          {dev !== null && (
                            <span className={cn('rounded-full border px-1.5 font-mono text-[0.58rem] font-bold', dev > 20 ? 'border-[#FF4D6A]/35 text-[#FF4D6A]' : 'border-white/[0.08] text-[#00E68A]')}>
                              DEV {dev < 1 ? '<1' : Math.round(dev)}%
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-mono text-[0.78rem] font-bold text-white">
                          <span className="mr-0.5 text-[0.58rem] text-white/40">MC</span>
                          {usd(x.marketCapUsd)}
                        </span>
                        <span className="flex items-center gap-0.5 rounded-full bg-[#00FF87] px-2 py-0.5 font-mono text-[0.62rem] font-bold text-black">
                          <Zap className="h-2.5 w-2.5" fill="currentColor" aria-hidden />$5
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
