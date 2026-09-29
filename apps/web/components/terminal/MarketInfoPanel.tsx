import { CHAIN_REGISTRY, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { formatCompactUsd, formatPrice, truncateAddress } from '@/lib/format';

/**
 * Compact market context for the terminal's right rail. This fills the same orientation
 * role as a competitor's "About" card, but only renders facts Kamby actually owns: chain,
 * venue, quote asset, liquidity, market cap, and the real token address. Descriptions and
 * social links stay out until Kamby has an authoritative source for them.
 */
export function MarketInfoPanel({ market }: { market: MarketSummary }) {
  const slug = slugForIdentifier(market.chainIdentifier);
  const chainName = slug ? CHAIN_REGISTRY[slug].name : market.chainIdentifier;
  const display = market.symbol ?? market.name ?? 'Token';

  return (
    <Surface className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-bold text-ink-900">About ${display}</h3>
          <p className="mt-0.5 font-body text-xs text-ink-400">Indexed market facts</p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-surface-raised px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">
          {chainName}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Fact label="Price" value={formatPrice(market.priceUsd)} />
        <Fact label="Market cap" value={formatCompactUsd(market.marketCapUsd)} />
        <Fact label="Liquidity" value={formatCompactUsd(market.liquidityUsd)} />
        <Fact label="24h volume" value={formatCompactUsd(market.volume24hUsd)} />
      </div>

      <div className="mt-3 space-y-2 border-t border-line pt-3 font-mono text-[0.65rem]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-400">Venue</span>
          <span className="truncate text-right text-ink-900">{market.dex ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-400">Quote</span>
          <span className="text-right text-ink-900">{market.quoteSymbol ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-400">Contract</span>
          <span className="flex min-w-0 items-center gap-1.5 text-ink-900">
            <span className="truncate" title={market.tokenAddress}>
              {truncateAddress(market.tokenAddress)}
            </span>
            <CopyAddressButton address={market.tokenAddress} />
          </span>
        </div>
      </div>
    </Surface>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-2.5 py-2">
      <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs font-semibold tabular-nums text-ink-900">
        {value}
      </div>
    </div>
  );
}
