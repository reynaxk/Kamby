import {
  CHAIN_REGISTRY,
  DISCOVERY_RANKING,
  slugForIdentifier,
  type MarketSummary,
} from '@kamby/domain';
import { Surface } from '@kamby/ui';
import { formatCompactUsd, formatPrice, cashtag } from '@/lib/format';
import { LowLiquidityBadge } from '@/components/market/LowLiquidityBadge';
import { PriceChange } from '@/components/market/PriceChange';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { WatchButton } from '@/components/market/WatchButton';

/**
 * Top metrics strip in the terminal, ported to production 2026-09-16 — see
 * KambyTerminal.tsx. Real `MarketSummary` fields directly, no fabricated formulas: the
 * mock version derived price from `marketCapUsd / 1e9` and faked 24h Vol/Liquidity as
 * fixed fractions of market cap. The "LP Burned" badge is gone entirely, not replaced with
 * an honest placeholder — there's no real on-chain LP-burn verification behind it to ever
 * fill that placeholder with, unlike Positions/caller-alpha's genuine "coming soon" gaps.
 *
 * `glass` as of the visual overhaul — the one always-visible "cockpit readout" strip in the
 * terminal, separated from the flat panels below it without adding density.
 */
export function TokenMetricsBar({ market }: { market: MarketSummary }) {
  const display = market.symbol ?? market.name ?? '?';
  const chainSlug = slugForIdentifier(market.chainIdentifier);
  const chainName = chainSlug ? CHAIN_REGISTRY[chainSlug].name : market.chainIdentifier;
  const isLowLiquidity =
    market.liquidityUsd === null || market.liquidityUsd < DISCOVERY_RANKING.minLiquidityUsd;

  return (
    <Surface className="kamby-token-metrics flex flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-2.5">
      <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
        {market.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={market.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-sm font-bold text-accent"
          >
            {display.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold tracking-tight text-ink-900">
              {cashtag(market.symbol ?? display)}
            </span>
            {isLowLiquidity && <LowLiquidityBadge />}
          </div>
          <div className="flex items-center gap-1.5 truncate font-mono text-[0.6rem] text-ink-400">
            <span className="truncate">
              {market.name ?? 'Indexed market'} · {chainName}
            </span>
            <span className="shrink-0">
              {market.tokenAddress.slice(0, 6)}…{market.tokenAddress.slice(-4)}
            </span>
            <CopyAddressButton address={market.tokenAddress} />
          </div>
        </div>
      </div>
      <Metric label="Price" value={formatPrice(market.priceUsd)} />
      <Metric label="Mkt Cap" value={formatCompactUsd(market.marketCapUsd)} />
      <Metric label="24h Vol" value={formatCompactUsd(market.volume24hUsd)} />
      <Metric label="Liquidity" value={formatCompactUsd(market.liquidityUsd)} />
      <div>
        <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">24h</div>
        <PriceChange value={market.priceChange24hPct} className="text-sm font-semibold" />
      </div>
      {chainSlug && (
        <WatchButton
          address={market.tokenAddress}
          chainId={CHAIN_REGISTRY[chainSlug].numericId}
          initialWatching={null}
          compact
        />
      )}
    </Surface>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-mono text-sm font-semibold tracking-tight tabular-nums text-ink-900">
        {value}
      </div>
    </div>
  );
}
