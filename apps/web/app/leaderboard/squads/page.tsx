import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { LeaderTabs } from '@/components/squads/LeaderTabs';
import { SquadWars } from '@/components/squads/SquadWars';

export const metadata = { title: 'Squad Wars — Kamby' };

/** Squad Wars (2026-10-17): communities ranked by their traders' month on Kamby. */
export default async function SquadWarsPage() {
  const t = await getTranslations('squads');
  const tL = await getTranslations('leaderboard');
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">{tL('title')}</h1>
        <p className="mt-1 max-w-md font-mono text-xs text-ink-400 max-md:hidden">{t('subtitle')}</p>
        <LeaderTabs active="squads" traders={t('traders')} squads={t('squads')} />
        <SquadWars />
      </main>
    </div>
  );
}
