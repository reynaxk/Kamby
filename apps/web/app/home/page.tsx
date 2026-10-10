import { emptyMarketFeeds } from '@kamby/domain';
import { CoinRail } from '@/components/discovery/CoinRail';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PortfolioHeader } from '@/components/home/PortfolioHeader';
import { TopTradersStrip } from '@/components/home/TopTradersStrip';
import { fetchMarketFeeds } from '@/lib/market-api';

export const metadata = { title: 'Kamby' };

/**
 * The app's home screen (2026-10-09 redesign, after a walkthrough of fomo's app): your whole
 * balance with Deposit, this week's top traders, and the live coin lists — tap a coin to open
 * it. The installed app (PWA) opens here; the desktop terminal stays at /terminal.
 */
export default async function HomePage() {
  const feeds = (await fetchMarketFeeds()) ?? emptyMarketFeeds();
  return (
    <>
    <div className="hidden md:block">
      <MarketHeader />
    </div>
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-4">
      <div className="px-4 md:px-0">
        <PortfolioHeader />
        <TopTradersStrip />
      </div>
      <div className="mt-3 h-[calc(100dvh-13rem)] min-h-[420px]">
        <CoinRail initial={feeds} selectedKey={null} />
      </div>
    </main>
    </>
  );
}
