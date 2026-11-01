import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { NewsFeed } from '@/components/news/NewsFeed';
import { getTranslations } from 'next-intl/server';

export const metadata = { title: 'Crypto news — Kamby' };
// Same wagmi/Privy build-time prerender crash as app/watchlist — nothing static here anyway.
export const dynamic = 'force-dynamic';

/**
 * Crypto news (2026-10-31): headlines from CoinDesk, Cointelegraph, Decrypt, Blockworks and
 * Bitcoin Magazine, newest first and live — each opens the article on the publisher's site,
 * each coin tag opens that coin's trading page. Big cards, one column (owner); the alert
 * switches are in notification settings. 2026-11-01 (owner): no search bar or heading — just the
 * headlines, four to a row on wide screens, loading more as you scroll.
 */
export default async function NewsPage() {
  const t = await getTranslations('news');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" search={false} />
      <AppBackBar title={t('title')} fallback="/home" />
      <main className="mx-auto max-w-[1400px] px-6 py-8 max-md:px-4 max-md:pt-2">
        <NewsFeed large grid />
      </main>
    </div>
  );
}
