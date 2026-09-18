import type { MarketSummary } from '@kamby/domain';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { PriceChange } from '@/components/market/PriceChange';

/**
 * Top metrics strip in the terminal, ported to production 2026-09-16 — see
 * KambyTerminal.tsx. Real `MarketSummary` fields directly, no fabricated formulas: the
 * mock version derived price from `marketCapUsd / 1e9` and faked 24h Vol/Liquidity as
 * fixed fractions of market cap. The "LP Burned" badge is gone entirely, not replaced with
 * an honest placeholder — there's no real on-chain LP-burn verification behind it to ever
 * fill that placeholder with, unlike Positions/caller-alpha's genuine "coming soon" gaps.
 */
export function TokenMetricsBar({ market }: { market: MarketSummary }) {
  const display = market.symbol ?? market.name ?? '?';

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-xs font-bold text-accent"
        >
          {display.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-display text-base font-bold text-ink-900">${market.symbol ?? display}</span>
      </div>
      <Metric label="Price" value={formatPrice(market.priceUsd)} />
      <Metric label="Mkt Cap" value={formatCompactUsd(market.marketCapUsd)} />
      <Metric label="24h Vol" value={formatCompactUsd(market.volume24hUsd)} />
      <Metric label="Liquidity" value={formatCompactUsd(market.liquidityUsd)} />
      <div>
        <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">24h</div>
        <PriceChange value={market.priceChange24hPct} className="text-sm font-semibold" />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-mono text-sm font-semibold text-ink-900">{value}</div>
    </div>
  );
}
