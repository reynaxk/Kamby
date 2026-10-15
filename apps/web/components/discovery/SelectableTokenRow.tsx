'use client';

import { CHAIN_REGISTRY, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { cn } from '@kamby/ui';
import { formatCompactUsd, formatPercent, cashtag } from '@/lib/format';
import { Sparkline } from '@/components/market/Sparkline';
import { NewListingBadge } from './feeds/NewListingBadge';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { PriceText } from '@/components/market/PriceText';
import { LaunchpadBadge } from '@/components/market/LaunchpadBadge';
import { memo } from 'react';
import { useTranslations } from 'next-intl';

/** A left-rail terminal row — modeled on TrenchesPanel.tsx's own TrendingHolderRow markup,
 *  but a button that selects the token in place (DiscoverTerminal's own state) instead of a
 *  Link that navigates away. 'use client' since 2026-10-03 (broken-logo fallback state); before that it had no hooks, same reasoning
 *  TokenMetricsBar/TokenTradersPanel already rely on for living safely inside a client
 *  subtree. */
function SelectableTokenRowView({
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
  const tU = useTranslations('ui');
  const isUp = (market.priceChange24hPct ?? 0) >= 0;
  // A dead logo link (common for brand-new coins) falls back to the coin's initial.
  const chainSlug = slugForIdentifier(market.chainIdentifier);
  const chainLabel = chainSlug
    ? CHAIN_REGISTRY[chainSlug].name
    : market.chainIdentifier.toLowerCase() === 'solana'
      ? 'Solana'
      : tU('otherChain_c46e');
  const unavailable = !chainSlug && disabled;

  return (
    <button
      type="button"
      onClick={() => onSelect(market)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={
        unavailable
          ? `${market.symbol ?? tU('token_459a')} on ${chainLabel} is not selectable yet`
          : undefined
      }
      title={
        unavailable
          ? `${chainLabel} markets are visible for discovery but are not tradeable here yet`
          : undefined
      }
      className={cn(
        'terminal-token-row relative flex w-full items-center gap-2.5 border-b border-line/60 px-2.5 py-2.5 text-left transition-all max-md:gap-3 max-md:border-0 max-md:px-4 max-md:py-3',
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
      <span className="relative shrink-0">
      <TokenAvatar
        src={market.logoUrl}
        seed={market.tokenAddress}
        label={market.symbol ?? market.tokenAddress}
        className={cn('terminal-token-avatar h-9 w-9 text-[0.85rem] max-md:h-11 max-md:w-11', selected && 'ring-2 ring-accent/60')}
      />
      {badgeChainFor(market.chainIdentifier) && <ChainBadge chain={badgeChainFor(market.chainIdentifier)!} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[0.88rem] font-semibold tracking-tight text-ink-900 max-md:text-base">
          {cashtag(market.symbol ?? market.tokenAddress.slice(0, 6))}
          {isNew && <NewListingBadge className="ml-1 align-middle max-md:ml-1.5" />}
          <LaunchpadBadge chain={market.chainIdentifier} address={market.tokenAddress} className="ml-1 align-middle max-md:hidden" />
        </span>
        <span className="terminal-token-row-meta block font-mono text-[0.7rem] tabular-nums text-ink-400">
          <span className="max-md:hidden">{chainLabel} · </span>{formatCompactUsd(market.marketCapUsd)} MC
        </span>
      </span>
      {market.recentCloses && market.recentCloses.length >= 2 && (
        // Phones too (2026-10-15, Robinhood-app feel) — only where there's real history to draw.
        <span className="terminal-token-sparkline max-md:mr-1">
          <Sparkline closes={market.recentCloses} width={44} height={22} />
        </span>
      )}
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-[0.82rem] font-semibold tabular-nums text-ink-900 max-md:text-base">
          <PriceText value={market.priceUsd} flash />
        </span>
        <span
          className={cn(
            'rounded-full px-1 py-0.5 font-mono text-[0.7rem] font-semibold tabular-nums max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:text-xs',
            isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
          )}
        >
          {market.priceChange24hPct !== null && <span className="mr-0.5 text-[0.6rem] md:hidden" aria-hidden>{isUp ? '▲' : '▼'}</span>}
          {formatPercent(market.priceChange24hPct)}
        </span>
      </span>
    </button>
  );
}

const SHOWN_FIELDS = ['tokenAddress', 'chainIdentifier', 'symbol', 'logoUrl', 'priceUsd', 'priceChange24hPct', 'marketCapUsd'] as const;

function sameCloses(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Memoized on what the row shows (2026-10-12, "make it smoother"): every live feed tick
 *  rebuilt all ~100 rows mid-scroll; now only rows whose numbers changed re-render. */
export const SelectableTokenRow = memo(SelectableTokenRowView, (prev, next) =>
  prev.selected === next.selected &&
  prev.disabled === next.disabled &&
  prev.isNew === next.isNew &&
  prev.onSelect === next.onSelect &&
  SHOWN_FIELDS.every((field) => prev.market[field] === next.market[field]) &&
  sameCloses(prev.market.recentCloses, next.market.recentCloses),
);
