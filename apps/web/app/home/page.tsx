import { emptyMarketFeeds } from '@kamby/domain';
import { CoinRail } from '@/components/discovery/CoinRail';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PortfolioHeader } from '@/components/home/PortfolioHeader';
import { TopTradersStrip } from '@/components/home/TopTradersStrip';
import { HomeHoldings } from '@/components/home/HomeHoldings';
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
    {/* Wide screens (2026-10-28, GMGN-like terminal): your money on the left, the coin lists
        across the rest — wide enough for XXXRisk's three columns side by side. */}
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-4 xl:grid xl:max-w-[1560px] xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start xl:gap-6">
      <div className="xl:sticky xl:top-16">
        <div className="px-4 md:px-0">
          <PortfolioHeader />
          <TopTradersStrip />
        </div>
        <HomeHoldings />
      </div>
      <div className="mt-3 md:h-[calc(100dvh-13rem)] md:min-h-[420px] xl:mt-6 xl:h-[calc(100dvh-6.5rem)]">
        <CoinRail initial={feeds} selectedKey={null} pageScroll />
      </div>
    </main>
    </>
  );
}
