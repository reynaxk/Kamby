import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { LeaderTabs } from '@/components/squads/LeaderTabs';
import { TrackFeed } from '@/components/track/TrackFeed';

export const metadata = { title: 'Track — Kamby' };

/** Track (2026-10-29): big trades and the traders you follow, live — next to the leaderboard. */
export default async function TrackPage() {
  const t = await getTranslations('squads');
  const tL = await getTranslations('leaderboard');
  const tD = await getTranslations('duels');
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">{tL('title')}</h1>
        <LeaderTabs active="track" traders={t('traders')} squads={t('squads')} duels={tD('tab')} />
        <TrackFeed />
      </main>
    </div>
  );
}
