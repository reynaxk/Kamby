import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@kamby/ui';
import { SearchBar } from '@/components/market/SearchBar';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';
import { marketHref } from '@/lib/solana-links';
import { cashtag, formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';

export const metadata = { title: 'Search — Kamby' };

/** The app's Search tab (2026-10-09; trending list under it 2026-10-10 — an empty screen until
 *  you typed felt like a website): Kamby's coin search, then what's trending right now. */
export default async function SearchPage() {
  const tU = await getTranslations('ui');
  const feeds = await soft(fetchMarketFeeds(), null);
  const trending = (feeds?.trending.markets ?? []).slice(0, 15);
  return (
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg pt-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="px-4">
        <SearchBar />
      </div>
      {trending.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 pb-1 font-display text-sm font-semibold text-ink-400">{tU('trending_3752')}</h2>
          <ul>
            {trending.map((m) => {
              const href = marketHref(m.chainIdentifier, m.tokenAddress);
              const chain = badgeChainFor(m.chainIdentifier);
              const up = (m.priceChange24hPct ?? 0) >= 0;
              if (!href) return null;
              return (
                <li key={`${m.chainIdentifier}:${m.tokenAddress}`}>
                  <Link href={href} className="flex items-center gap-3 px-4 py-3 active:bg-white/5">
                    <span className="relative shrink-0">
                      <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol ?? m.tokenAddress} className="h-11 w-11 text-sm" />
                      {chain && <ChainBadge chain={chain} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-base font-semibold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))}</span>
                      <span className="block font-body text-xs tabular-nums text-ink-400">{formatCompactUsd(m.marketCapUsd)} MC</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-body text-base font-semibold tabular-nums text-ink-900">{formatPrice(m.priceUsd)}</span>
                      <span className={cn('block font-body text-xs font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.priceChange24hPct)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
