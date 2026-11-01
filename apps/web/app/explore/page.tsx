import { emptyMarketFeeds } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { ExploreView } from '@/components/discovery/ExploreView';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Explore — Kamby' };
export const dynamic = 'force-dynamic';

/** Explore (2026-11-01, owner): trending coins on every chain and your watchlist, as two tabs. */
export default async function ExplorePage({ searchParams }: { searchParams: { tab?: string } }) {
  const t = await getTranslations('explorePage');
  const feeds = (await soft(fetchMarketFeeds(), null)) ?? emptyMarketFeeds();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="hidden md:block">
        <MarketHeader />
      </div>
      <PageTopBar />
      <main className="mx-auto max-w-[1680px] pb-28 md:px-5 md:pt-4 md:pb-10">
        <ExploreView initial={feeds} initialTab={searchParams.tab === 'watchlist' ? 'watchlist' : 'trending'} />
      </main>
    </div>
  );
}
