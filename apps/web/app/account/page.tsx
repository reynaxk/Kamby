import { MarketHeader } from '@/components/market/MarketHeader';
import { BlurBalancesToggle } from '@/components/account/BlurBalancesToggle';
import { ProfileEditor } from '@/components/account/ProfileEditor';
import { PnlHistoryChart } from '@/components/discovery/PnlHistoryChart';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';
import { ChainBalancesCard } from '@/components/wallet/ChainBalancesCard';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';
import { getTranslations } from 'next-intl/server';

export const metadata = { title: 'Your profile — Kamby' };
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
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-ink-900">{t('title')}</h1>
            <p className="mt-1 font-body text-sm text-ink-600">
              {t('subtitle')}
            </p>
          </div>
        </div>
        <section aria-labelledby="wallet-heading" className="mt-6 rounded-2xl border border-line bg-surface p-4">
          <h2 id="wallet-heading" className="font-display text-sm font-semibold text-ink-900">{t('wallet')}</h2>
          <p className="mt-1 font-body text-xs text-ink-600">{t('walletSub')}</p>
          <div className="mt-4">
            <ChainBalancesCard />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <FundButton variant="labeled" />
            <SendButton variant="labeled" />
            <BlurBalancesToggle variant="labeled" />
          </div>
          <LanguageSelect className="mt-4 max-w-xs" />
        </section>
        <div id="profile" className="mt-6 scroll-mt-20">
          <ProfileEditor />
        </div>
        <div className="mt-8">
          <PnlHistoryChart />
        </div>
      </main>
    </div>
  );
}
