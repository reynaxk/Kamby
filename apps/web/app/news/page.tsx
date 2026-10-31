import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { NewsFeed } from '@/components/news/NewsFeed';
import { NewsAlertSettings } from '@/components/news/NewsAlertSettings';
import { NEWS_SOURCES } from '@kamby/domain';
import { getTranslations } from 'next-intl/server';

export const metadata = { title: 'Crypto news — Kamby' };
// Same wagmi/Privy build-time prerender crash as app/watchlist — nothing static here anyway.
export const dynamic = 'force-dynamic';

/**
 * Crypto news (2026-10-31): headlines from CoinDesk, Cointelegraph, Decrypt, Blockworks and
 * Bitcoin Magazine, newest first and live — each opens the article on the publisher's site,
 * each coin tag opens that coin's trading page.
 */
export default async function NewsPage() {
  const t = await getTranslations('news');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={t('title')} fallback="/home" />
      <main className="mx-auto max-w-5xl px-6 py-8 max-md:px-4 max-md:pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ink-900 max-md:hidden">{t('title')}</h1>
          <p className="mt-1 font-body text-sm text-ink-400">{t('subtitle')}</p>
          <NewsFeed className="mt-5" />
        </div>
        <aside className="mt-6 flex flex-col gap-3 lg:sticky lg:top-20 lg:mt-12">
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface p-1">
            <NewsAlertSettings />
          </div>
          <p className="px-1 font-body text-xs leading-relaxed text-ink-400">
            {t('sources', { list: NEWS_SOURCES.map((s) => s.name).join(', ') })}
          </p>
        </aside>
      </main>
    </div>
  );
}
