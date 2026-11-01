import { emptyMarketFeeds } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { TrendingTable } from '@/components/discovery/TrendingTable';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Trending — Kamby' };

/** Trending (2026-11-01): every chain's trending coins as one GMGN-style table. */
export default async function TrendingPage() {
  const t = await getTranslations('trendingPage');
  const feeds = (await soft(fetchMarketFeeds(), null)) ?? emptyMarketFeeds();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="hidden md:block">
        <MarketHeader />
      </div>
      <PageTopBar title={t('title')} />
      <main className="mx-auto max-w-[1680px] pb-28 md:px-5 md:pt-4 md:pb-10">
        <div className="mb-3 hidden md:block">
          <h1 className="font-display text-2xl font-black tracking-tight text-ink-900">{t('title')}</h1>
          <p className="mt-0.5 font-body text-sm text-ink-400">{t('sub')}</p>
        </div>
        <TrendingTable initial={feeds} />
      </main>
    </div>
  );
}
