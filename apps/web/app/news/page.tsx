import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { NewsFeed } from '@/components/news/NewsFeed';
import { NEWS_SOURCES } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';

export const metadata = { title: 'Crypto news — Kamby' };
// Same wagmi/Privy build-time prerender crash as app/watchlist — nothing static here anyway.
export const dynamic = 'force-dynamic';

/**
 * Crypto news (2026-10-31): headlines from CoinDesk, Cointelegraph, Decrypt, Blockworks and
 * Bitcoin Magazine, newest first and live — each opens the article on the publisher's site,
 * each coin tag opens that coin's trading page. Big cards, one column (owner); the alert
 * switches are in notification settings.
 */
export default async function NewsPage() {
  const t = await getTranslations('news');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={t('title')} fallback="/home" />
      <main className="mx-auto max-w-3xl px-6 py-8 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-2xl font-extrabold text-ink-900 max-md:hidden">{t('title')}</h1>
        <p className="mt-1 font-body text-sm text-ink-400">{t('sources', { list: NEWS_SOURCES.map((s) => s.name).join(', ') })}</p>
        <NewsFeed className="mt-5" large />
      </main>
    </div>
  );
}
