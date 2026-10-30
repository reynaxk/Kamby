import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FeedMarket, MarketFeedSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { cashtag, formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { ProfileTabs } from '@/components/social/ProfileTabs';

/**
 * Wide desktop home, right column (2026-10-30 redesign, owner's concepts): Top Gainers and Top
 * Traded from the same Trending snapshot the coin lists use — five rows each, a click opens the coin.
 */
export async function HomeMarketsAside({ feeds }: { feeds: MarketFeedSnapshot }) {
  const t = await getTranslations('home');
  const markets = feeds.trending.markets;
  if (markets.length === 0) return null;
  const gainers = [...markets]
    .filter((m) => (m.priceChange24hPct ?? 0) > 0)
    .sort((a, b) => (b.priceChange24hPct ?? 0) - (a.priceChange24hPct ?? 0))
    .slice(0, 5);
  const traded = [...markets]
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, 5);
  return (
    // One card, two tabs — the column stays short (2026-10-30 tidy pass).
    <section className="mt-5 rounded-2xl border border-line bg-surface px-3.5 pb-1 pt-1">
      <ProfileTabs
        tabs={[
          ...(gainers.length > 0
            ? [
                {
                  key: 'gainers',
                  label: t('topGainers'),
                  content: <Rows rows={gainers} show="mc" />,
                },
              ]
            : []),
          { key: 'traded', label: t('topTraded'), content: <Rows rows={traded} show="vol" /> },
        ]}
      />
    </section>
  );
}

function Rows({ rows, show }: { rows: FeedMarket[]; show: 'mc' | 'vol' }) {
  return (
    <ul className="-mt-3">
      {rows.map((m) => {
        const href = marketHref(m.chainIdentifier, m.tokenAddress);
        const change = m.priceChange24hPct ?? null;
        const row = (
          <>
            <TokenAvatar
              src={m.logoUrl}
              seed={m.tokenAddress}
              label={m.symbol}
              className="h-8 w-8 shrink-0 text-xs"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold text-ink-900">
                {cashtag(m.symbol ?? '')}
              </span>
              <span className="block font-mono text-[0.65rem] text-ink-400">
                {show === 'mc'
                  ? `MC ${formatCompactUsd(m.marketCapUsd ?? null)}`
                  : `Vol ${formatCompactUsd(m.volume24hUsd ?? null)}`}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-xs tabular-nums text-ink-900">
                {formatPrice(m.priceUsd ?? null)}
              </span>
              <span
                className={cn(
                  'block font-mono text-[0.7rem] tabular-nums',
                  change === null ? 'text-ink-400' : change >= 0 ? 'text-up' : 'text-down',
                )}
              >
                {formatPercent(change)}
              </span>
            </span>
          </>
        );
        return (
          <li
            key={`${m.chainIdentifier}:${m.tokenAddress}`}
            className="border-t border-line first:border-t-0"
          >
            {href ? (
              <Link
                href={href}
                className="flex h-12 items-center gap-2.5 transition-colors hover:bg-white/[0.02]"
              >
                {row}
              </Link>
            ) : (
              <div className="flex h-12 items-center gap-2.5">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
