import { emptyMarketFeeds } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { TrenchesBoard } from '@/components/discovery/TrenchesBoard';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Hunt — Kamby' };

/**
 * Hunt (2026-11-01, owner: first XXXRisk, then Trenches, then "rename it to Hunt"): the launchpad board — New, Almost bonded
 * and Migrated across every launchpad and chain, with the full filter panel — as Kamby's start
 * page. /home, /terminal and /trenches redirect here.
 */
export default async function HuntPage() {
  const t = await getTranslations('huntPage');
  const feeds = (await soft(fetchMarketFeeds(), null)) ?? emptyMarketFeeds();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="hidden md:block">
        <MarketHeader />
      </div>
      <PageTopBar title={t('title')} />
      <p className="px-4 pb-2 font-body text-sm text-ink-400 md:hidden">{t('sub')}</p>
      <main className="mx-auto max-w-[1680px] pb-28 md:px-5 md:pt-4 md:pb-10">
        <div className="mb-3 hidden items-end justify-between gap-4 md:flex">
          <div>
            <h1 className="font-display text-2xl font-black tracking-tight text-ink-900">{t('title')}</h1>
            <p className="mt-0.5 font-body text-sm text-ink-400">{t('sub')}</p>
          </div>
        </div>
        <TrenchesBoard initial={feeds} />
      </main>
    </div>
  );
}
