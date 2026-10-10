import { type MarketSummary, slugForIdentifier } from '@kamby/domain';
import Link from 'next/link';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { solanaMarketHref } from '@/lib/solana-links';
import { EmptyState } from './EmptyState';
import { PriceChange } from './PriceChange';
import { StaleBadge } from './StaleBadge';
import { TokenIdentity } from './TokenIdentity';
import { useTranslations } from 'next-intl';

export function MarketTable({ markets }: { markets: MarketSummary[] }) {
  const tU = useTranslations('ui');
  if (markets.length === 0) {
    return (
      <EmptyState
        title={tU('noMarketDataAvailableYet_9a9f')}
        detail="The ingestion worker hasn't published a priced snapshot for any tracked market. Check back shortly."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[0.7rem] uppercase tracking-wide text-ink-400">
            <th className="px-4 py-3 font-medium">{tU('token_459a')}</th>
            <th className="px-4 py-3 text-right font-medium">{tU('price_3601')}</th>
            <th className="px-4 py-3 text-right font-medium">24H</th>
            <th className="px-4 py-3 text-right font-medium">{tU('volume_bd7a')}</th>
            <th className="px-4 py-3 text-right font-medium">{tU('liquidity_ced4')}</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const chainSlug = slugForIdentifier(market.chainIdentifier);
            const href = chainSlug
              ? `/market/${chainSlug}/${market.tokenAddress}`
              : market.chainIdentifier === 'solana'
                ? solanaMarketHref(market.tokenAddress)
                : null;

            return (
              <tr
                key={`${market.chainIdentifier}:${market.tokenAddress}`}
                className="group border-b border-line last:border-0"
              >
                <td className="p-0">
                  {href ? (
                    <Link
                      // Chain-aware URL as of 2026-09-16 (BNB Chain going live); Solana
                      // markets open the Solana trade page instead (no per-token page yet).
                      href={href}
                      className="flex items-center gap-3 px-4 py-3 transition-colors group-hover:bg-surface-raised"
                    >
                      <TokenIdentity
                        symbol={market.symbol}
                        name={market.name}
                        logoUrl={market.logoUrl}
                        size="sm"
                      />
                      {market.isStale && <StaleBadge />}
                    </Link>
                  ) : (
                    <div
                      className="flex items-center gap-3 px-4 py-3 opacity-70"
                      title={tU('thisMarketIsVisibleFor_626f')}
                    >
                      <TokenIdentity
                        symbol={market.symbol}
                        name={market.name}
                        logoUrl={market.logoUrl}
                        size="sm"
                      />
                      {market.isStale && <StaleBadge />}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-900">
                  {formatPrice(market.priceUsd)}
                </td>
                <td className="px-4 py-3 text-right">
                  <PriceChange value={market.priceChange24hPct} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-600">
                  {formatCompactUsd(market.volume24hUsd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-600">
                  {formatCompactUsd(market.liquidityUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
