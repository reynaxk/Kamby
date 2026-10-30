import { emptyMarketFeeds } from '@kamby/domain';
import { CoinRail } from '@/components/discovery/CoinRail';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PortfolioHeader } from '@/components/home/PortfolioHeader';
import { TopTradersStrip } from '@/components/home/TopTradersStrip';
import { HomeHoldings } from '@/components/home/HomeHoldings';
import { TrackFeed } from '@/components/track/TrackFeed';
import { HomeSocialTop } from '@/components/home/HomeSocialTop';
import { HomeMarketsAside } from '@/components/home/HomeMarketsAside';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Kamby' };

/**
 * The app's home screen (2026-10-09 redesign, after a walkthrough of fomo's app): your whole
 * balance with Deposit, this week's top traders, and the live coin lists — tap a coin to open
 * it. The installed app (PWA) opens here; the desktop terminal stays at /terminal.
 */
export default async function HomePage() {
  // Capped — the lists stream in live anyway (lib/soft.ts).
  const feeds = (await soft(fetchMarketFeeds(), null)) ?? emptyMarketFeeds();
  return (
    <>
    <div className="kamby-void hidden md:block">
      <MarketHeader />
    </div>
    {/* Wide screens (2026-10-30 redesign, owner's concepts): stories, who's live and the coin lists
        in the main column; your money, top traders, holdings and whales in a column on the right. */}
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-4 xl:grid xl:max-w-[1560px] xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-6 xl:px-6 xl:pt-6">
      <div className="xl:sticky xl:top-20 xl:order-2 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:pb-6 xl:[scrollbar-width:none]">
        <div className="px-4 md:px-0">
          <PortfolioHeader />
          <TopTradersStrip />
        </div>
        <HomeHoldings />
        {/* Wide screens: the column under your money was empty — whales trading right now. */}
        <TrackFeed compact />
        <div className="hidden xl:block">
          <HomeMarketsAside feeds={feeds} />
        </div>
      </div>
      <div className="mt-3 xl:order-1 xl:mt-0">
        <HomeSocialTop />
        <div className="md:h-[calc(100dvh-13rem)] md:min-h-[420px] xl:h-[calc(100dvh-8rem)]">
          <CoinRail initial={feeds} selectedKey={null} pageScroll />
        </div>
      </div>
    </main>
    </>
  );
}
