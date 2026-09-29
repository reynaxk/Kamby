import { CHAIN_REGISTRY, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';
import { Sparkline } from '@/components/market/Sparkline';

/** A left-rail terminal row — modeled on TrenchesPanel.tsx's own TrendingHolderRow markup,
 *  but a button that selects the token in place (DiscoverTerminal's own state) instead of a
 *  Link that navigates away. No 'use client' needed: no hooks here, same reasoning
 *  TokenMetricsBar/TokenTradersPanel already rely on for living safely inside a client
 *  subtree. */
export function SelectableTokenRow({
  market,
  selected,
  onSelect,
  disabled,
}: {
  market: MarketSummary;
  selected: boolean;
  onSelect: (market: MarketSummary) => void;
  disabled?: boolean;
}) {
  const isUp = (market.priceChange24hPct ?? 0) >= 0;
  const chainSlug = slugForIdentifier(market.chainIdentifier);
  const chainLabel = chainSlug
    ? CHAIN_REGISTRY[chainSlug].name
    : market.chainIdentifier.toLowerCase() === 'solana'
      ? 'Solana'
      : 'Other chain';
  const unavailable = !chainSlug && disabled;

  return (
    <button
      type="button"
      onClick={() => onSelect(market)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={
        unavailable
          ? `${market.symbol ?? 'Token'} on ${chainLabel} is not selectable yet`
          : undefined
      }
      title={
        unavailable
          ? `${chainLabel} markets are visible for discovery but are not tradeable here yet`
          : undefined
      }
      className={cn(
        'relative flex w-full items-center gap-2 border-b border-line/60 px-2.5 py-2 text-left transition-all',
        selected ? 'bg-surface-raised' : 'hover:bg-surface-raised',
        disabled && !selected && 'cursor-not-allowed opacity-50',
      )}
    >
      {selected && (
        <span
          className="absolute inset-y-0 left-0 w-0.5 bg-accent shadow-glow-accent"
          aria-hidden
        />
      )}
      {market.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={market.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold',
            selected
              ? 'bg-accent/15 text-accent shadow-glow-accent'
              : 'bg-surface-raised text-ink-600',
          )}
        >
          {(market.symbol ?? market.tokenAddress).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-semibold tracking-tight text-ink-900">
          ${market.symbol ?? market.tokenAddress.slice(0, 6)}
        </span>
        <span className="block font-mono text-[0.65rem] tabular-nums text-ink-400">
          {chainLabel} · {formatCompactUsd(market.marketCapUsd)} MC
        </span>
      </span>
      {market.recentCloses && market.recentCloses.length >= 2 && (
        <Sparkline closes={market.recentCloses} width={40} height={20} />
      )}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-xs font-semibold tabular-nums text-ink-900">
          {formatPrice(market.priceUsd)}
        </span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold tabular-nums',
            isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
          )}
        >
          {formatPercent(market.priceChange24hPct)}
        </span>
      </span>
    </button>
  );
}
