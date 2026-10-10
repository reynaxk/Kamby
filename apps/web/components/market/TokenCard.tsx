import { type MarketSummary } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { marketHref } from '@/lib/solana-links';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { PriceChange } from './PriceChange';
import { StaleBadge } from './StaleBadge';
import { TokenIdentity } from './TokenIdentity';
import { useTranslations } from 'next-intl';

export function TokenCard({ market }: { market: MarketSummary }) {
  const tU = useTranslations('ui');
  // Chain-aware URL — see marketHref (EVM market page, or the Solana trade page).
  const content = (
    <>
      {/* Lift + soft accent glow on hover only, not an idle/constant glow — matches the
          visual overhaul's Hyperliquid-restraint direction (interactive-only emphasis). */}
      <Surface className="flex h-full flex-col gap-4 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-surface-raised hover:shadow-glow-accent">
        <div className="flex items-start justify-between gap-2">
          <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} />
          {market.isStale && <StaleBadge />}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="font-mono text-lg font-semibold tabular-nums text-ink-900">
              {formatPrice(market.priceUsd)}
            </div>
            <PriceChange value={market.priceChange24hPct} className="mt-1" />
          </div>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3 font-mono text-xs tabular-nums text-ink-600">
          <div>
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">{tU('volume_bd7a')}</div>
            {formatCompactUsd(market.volume24hUsd)}
          </div>
          <div className="text-right">
            <div className="text-[0.65rem] uppercase tracking-wide text-ink-400">{tU('liquidity_ced4')}</div>
            {formatCompactUsd(market.liquidityUsd)}
          </div>
        </div>
      </Surface>
    </>
  );

  const href = marketHref(market.chainIdentifier, market.tokenAddress);
  if (!href) {
    return (
      <div title={tU('thisMarketIsVisibleFor_626f')}>
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}
