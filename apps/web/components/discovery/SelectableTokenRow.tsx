import { CHAIN_REGISTRY, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatPercent, formatPrice, cashtag } from '@/lib/format';
import { Sparkline } from '@/components/market/Sparkline';
import { NewListingBadge } from './feeds/NewListingBadge';

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
  isNew = false,
}: {
  market: MarketSummary;
  selected: boolean;
  onSelect: (market: MarketSummary) => void;
  disabled?: boolean;
  /** A discovered, not hand-picked listing — shows the "New" high-risk pill. */
  isNew?: boolean;
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
        'terminal-token-row relative flex w-full items-center gap-1.5 border-b border-line/60 px-2 py-1.5 text-left transition-all',
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
        <img
          src={market.logoUrl}
          alt=""
          className="terminal-token-avatar h-6 w-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          className={cn(
            'terminal-token-avatar flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-[0.65rem] font-bold',
            selected
              ? 'bg-accent/15 text-accent shadow-glow-accent'
              : 'bg-surface-raised text-ink-600',
          )}
        >
          {(market.symbol ?? market.tokenAddress).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[0.72rem] font-semibold tracking-tight text-ink-900">
          {cashtag(market.symbol ?? market.tokenAddress.slice(0, 6))}
          {isNew && <NewListingBadge className="ml-1 align-middle" />}
        </span>
        <span className="terminal-token-row-meta block font-mono text-[0.58rem] tabular-nums text-ink-400">
          {chainLabel} · {formatCompactUsd(market.marketCapUsd)} MC
        </span>
      </span>
      {market.recentCloses && market.recentCloses.length >= 2 && (
        <span className="terminal-token-sparkline">
          <Sparkline closes={market.recentCloses} width={40} height={20} />
        </span>
      )}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-[0.68rem] font-semibold tabular-nums text-ink-900">
          {formatPrice(market.priceUsd)}
        </span>
        <span
          className={cn(
            'rounded-full px-1 py-0.5 font-mono text-[0.58rem] font-semibold tabular-nums',
            isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
          )}
        >
          {formatPercent(market.priceChange24hPct)}
        </span>
      </span>
    </button>
  );
}
