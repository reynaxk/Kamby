import { emptyMarketFeeds } from '@kamby/domain';
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
  const feeds = (await soft(fetchMarketFeeds(), null)) ?? emptyMarketFeeds();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="hidden md:block">
        <MarketHeader />
      </div>
      <PageTopBar />
      <main className="mx-auto max-w-[1680px] pb-28 md:px-5 md:pt-4 md:pb-10">
        {/* No greeting line (Kamby Prime, 2026-11-04): the board starts right under the tabs. */}
        <TrenchesBoard initial={feeds} />
      </main>
    </div>
  );
}
