import { MarketHeader } from '@/components/market/MarketHeader';
import { PreferencesCard } from '@/components/account/PreferencesCard';
import { ProfileEditor } from '@/components/account/ProfileEditor';
import { PnlHistoryChart } from '@/components/discovery/PnlHistoryChart';
import { PortfolioTop } from '@/components/account/PortfolioTop';
import { PnlCalendar } from '@/components/account/PnlCalendar';
import { HomeHoldings } from '@/components/home/HomeHoldings';
import { ChainBalancesCard } from '@/components/wallet/ChainBalancesCard';
import { getTranslations } from 'next-intl/server';
import { AppProfileMenu } from '@/components/account/AppProfileMenu';
import { PhoneSignedInOnly } from '@/components/account/PhoneSignedInOnly';
import { SessionBootstrap } from '@/components/account/SessionBootstrap';
import { AchievementsShowcase } from '@/components/achievements/AchievementsShowcase';

export const metadata = { title: 'Portfolio — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/** Entirely client-rendered below the header, same reasoning as app/watchlist/page.tsx:
 *  the session lives in localStorage, invisible to a Server Component. Void-themed as of
 *  the visual overhaul — every page runs kamby-void now, not just the trading-facing ones. */
export default async function AccountPage() {
  const t = await getTranslations('account');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader search={false} />
      <SessionBootstrap />
      {/* Phones: the Profile tab as an app screen (sign in, lists, settings, sign out). */}
      <AppProfileMenu />
      <PhoneSignedInOnly>
      {/* Phones show all of this inside the Profile screen above (2026-10-28). */}
      {/* Kamby Prime (2026-11-04): a real Portfolio on computers — the total, P&L and your coins
          on the left; wallets per chain, the calendar, titles and settings on the right. */}
      <main className="mx-auto grid max-w-[1360px] grid-cols-1 gap-6 px-6 py-8 max-md:hidden lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <PortfolioTop />
          <div className="mt-6">
            <PnlHistoryChart />
          </div>
          <section className="mt-6 rounded-xl border border-line bg-[#0A0B0E] p-4">
            <HomeHoldings bare />
          </section>
        </div>
        <aside className="min-w-0 space-y-4">
          <section aria-labelledby="wallet-heading" className="rounded-xl border border-line bg-[#0A0B0E] p-4">
            <h2 id="wallet-heading" className="text-sm font-semibold text-ink-900">{t('wallet')}</h2>
            <div className="mt-4">
              <ChainBalancesCard />
            </div>
          </section>
          <section className="rounded-xl border border-line bg-[#0A0B0E] p-4">
            <PnlCalendar />
          </section>
          <AchievementsShowcase own />
          <PreferencesCard />
          <div id="profile" className="scroll-mt-20">
            <ProfileEditor />
          </div>
        </aside>
      </main>
      </PhoneSignedInOnly>
    </div>
  );
}
