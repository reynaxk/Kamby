import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { emptyMarketFeeds } from '@kamby/domain';
import { MarketHeader } from '@/components/market/MarketHeader';
import { SearchScreen } from '@/components/market/SearchScreen';
import { RecentSearches } from '@/components/market/RecentSearches';
import { SearchTrending } from '@/components/market/SearchTrending';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';
import { FEED_ENABLED } from '@/lib/feed-client';

export const metadata = { title: 'Search — Kamby' };

/** The app's Search tab (2026-10-09; trending list under it 2026-10-10 — an empty screen until
 *  you typed felt like a website): Kamby's coin search, then what's trending right now. */
export default async function SearchPage() {
  const feeds = await soft(fetchMarketFeeds(), null);
  return (
    <>
    {/* Computers get the site header like every other page (2026-10-29: Search had none). */}
    <div className="kamby-void hidden md:block">
      <MarketHeader />
    </div>
    <main className="kamby-void relative mx-auto min-h-screen max-w-2xl overflow-hidden bg-bg pt-[calc(env(safe-area-inset-top)+1rem)]">
      {/* Kamby's midnight + a faint K behind the glass, so the frosted search has something to frost. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] md:hidden" style={{ background: 'linear-gradient(180deg, #0E1430 0%, #0A0E22 38%, rgba(5,7,10,0) 100%)' }} />
      <svg aria-hidden className="pointer-events-none absolute -right-14 -top-8 md:hidden" width="260" height="260" viewBox="0 0 512 512">
        <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
          <path d="M186 140 V372" />
          <path d="M200 268 L338 140" />
          <path d="M232 246 L346 372" />
        </g>
      </svg>
      <div className="relative">
      <SearchScreen>
      <ExploreLinks />
      <RecentSearches />
      <SearchTrending initial={feeds ?? emptyMarketFeeds()} />
      </SearchScreen>
      </div>
    </main>
    </>
  );
}

/** Phones' way into the parts of Kamby that have no tab (2026-10-31): one row of shortcuts. */
async function ExploreLinks() {
  const t = await getTranslations('nav');
  const links = [
    { href: '/news', icon: '📰', label: t('news') },
    { href: '/live', icon: '🔴', label: t('live') },
    ...(FEED_ENABLED ? [{ href: '/feed', icon: '💬', label: t('feed') }] : []),
    { href: '/launch', icon: '🚀', label: t('launchpad') },
    { href: '/perps', icon: '⚡', label: t('perps') },
  ];
  return (
    <nav aria-label={t('menu')} className="-mx-0 mt-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 font-display text-sm font-bold text-ink-900 transition-colors active:bg-white/[0.08]">
          <span aria-hidden>{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
