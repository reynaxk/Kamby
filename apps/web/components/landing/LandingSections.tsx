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
