import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@kamby/ui';
import { SearchScreen } from '@/components/market/SearchScreen';
import { RecentSearches } from '@/components/market/RecentSearches';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { PriceText } from '@/components/market/PriceText';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatCompactUsd, formatPercent } from '@/lib/format';

export const metadata = { title: 'Search — Kamby' };

/** The app's Search tab (2026-10-09; trending list under it 2026-10-10 — an empty screen until
 *  you typed felt like a website): Kamby's coin search, then what's trending right now. */
export default async function SearchPage() {
  const tU = await getTranslations('ui');
  const feeds = await soft(fetchMarketFeeds(), null);
  const trending = (feeds?.trending.markets ?? []).slice(0, 15);
  return (
    <main className="kamby-void relative mx-auto min-h-screen max-w-2xl overflow-hidden bg-bg pt-[calc(env(safe-area-inset-top)+1rem)]">
      {/* Kamby's midnight + a faint K behind the glass, so the frosted search has something to frost. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[34rem]" style={{ background: 'linear-gradient(180deg, #0E1430 0%, #0A0E22 38%, rgba(5,7,10,0) 100%)' }} />
      <svg aria-hidden className="pointer-events-none absolute -right-14 -top-8" width="260" height="260" viewBox="0 0 512 512">
        <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
          <path d="M186 140 V372" />
          <path d="M200 268 L338 140" />
          <path d="M232 246 L346 372" />
        </g>
      </svg>
      <div className="relative">
      <SearchScreen>
      <RecentSearches />
      {trending.length > 0 && (
        <section className="mt-5">
          <h2 className="flex items-center gap-2 px-4 pb-1 font-display text-sm font-bold text-ink-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3c.5 3.5 4.5 5.5 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3.5 2-4.5.3 1.6 1.2 2.6 2.2 2.8C11 8.7 11.3 5.6 12 3Z" />
              </svg>
            </span>
            {tU('trending_3752')}
          </h2>
          <QuickBuyProvider>
          <ul>
            {trending.map((m) => {
              const href = marketHref(m.chainIdentifier, m.tokenAddress);
              const chain = badgeChainFor(m.chainIdentifier);
              const up = (m.priceChange24hPct ?? 0) >= 0;
              if (!href) return null;
              return (
                <li key={`${m.chainIdentifier}:${m.tokenAddress}`} className="flex items-center">
                  <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2.5">
                    <span className="relative shrink-0">
                      <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol ?? m.tokenAddress} className="h-11 w-11 text-sm" />
                      {chain && <ChainBadge chain={chain} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-base font-semibold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))}</span>
                      <span className="block font-body text-xs tabular-nums text-ink-400">{formatCompactUsd(m.marketCapUsd)} MC</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-body text-base font-semibold tabular-nums text-ink-900"><PriceText value={m.priceUsd} /></span>
                      <span className={cn('block font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.priceChange24hPct)}</span>
                    </span>
                  </Link>
                  <QuickBuyButton chainIdentifier={m.chainIdentifier} address={m.tokenAddress} label={cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))} className="mr-4" />
                </li>
              );
            })}
          </ul>
          </QuickBuyProvider>
        </section>
      )}
      </SearchScreen>
      </div>
    </main>
  );
}
