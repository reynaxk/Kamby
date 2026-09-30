import type { CryptoPrice } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { GlowValue } from '@/components/market/GlowValue';
import { CRYPTO_TRADE_TARGETS } from '@/lib/crypto-markets';
import { formatPercent, formatPrice } from '@/lib/format';

/** A Crypto-tab row: a live Coinbase spot price, opening the market it trades as on Kamby. */
export function CryptoFeedRow({ price, onOpen }: { price: CryptoPrice; onOpen: (price: CryptoPrice) => void }) {
  const target = CRYPTO_TRADE_TARGETS[price.symbol];
  const isUp = (price.change24hPct ?? 0) >= 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(price)}
      aria-label={`${price.symbol} ${formatPrice(price.priceUsd)} — open ${target.label}`}
      className="flex w-full items-center gap-1.5 border-b border-line/60 px-2 py-2 text-left transition-colors hover:bg-surface-raised"
    >
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-display text-[0.6rem] font-bold text-ink-600">
        {price.symbol.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[0.72rem] font-semibold tracking-tight text-ink-900">{price.symbol}</span>
        <span className="block truncate font-mono text-[0.58rem] text-ink-400">{target.label}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <GlowValue value={String(price.priceUsd)} display={formatPrice(price.priceUsd)} className="font-mono text-[0.68rem] font-semibold tabular-nums text-ink-900" />
        <span className={cn('rounded-full px-1 py-0.5 font-mono text-[0.58rem] font-semibold tabular-nums', isUp ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>
          {formatPercent(price.change24hPct)}
        </span>
      </span>
    </button>
  );
}
