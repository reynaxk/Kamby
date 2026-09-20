import type { MarketSummary } from '@kamby/domain';
import { ChevronDown } from 'lucide-react';

/**
 * The "independent token selector" for one Multi-Chart Grid cell — a plain native <select>,
 * not a custom-built search combobox. Native selects come with keyboard nav, mobile, and
 * accessibility handled for free, which matters here since a 6-up grid means six of these
 * on screen at once; a from-scratch searchable combobox is a real, separate undertaking,
 * left as a future enhancement rather than built speculatively now. Options come from
 * `availableMarkets` — the same already-fetched Markets/Trending/Movers/Volume lists the
 * single-terminal's left rail uses, deduplicated once by DiscoverTerminal — so picking a
 * token in a grid cell costs zero new fetches, same principle as everywhere else in this
 * terminal.
 */
export function CellTokenSelector({
  availableMarkets,
  selected,
  onSelect,
  disabled,
}: {
  availableMarkets: MarketSummary[];
  selected: MarketSummary | null;
  onSelect: (market: MarketSummary) => void;
  disabled?: boolean;
}) {
  const selectedKey = selected ? `${selected.chainIdentifier}:${selected.tokenAddress}` : '';

  return (
    <div className="relative">
      <select
        value={selectedKey}
        disabled={disabled}
        onChange={(event) => {
          const market = availableMarkets.find(
            (m) => `${m.chainIdentifier}:${m.tokenAddress}` === event.target.value,
          );
          if (market) onSelect(market);
        }}
        className="w-full appearance-none rounded-lg border border-line bg-surface-raised py-1.5 pl-2.5 pr-7 font-display text-sm font-semibold text-ink-900 outline-none transition-colors focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!selected && <option value="">Pick a token…</option>}
        {availableMarkets.map((market) => {
          const key = `${market.chainIdentifier}:${market.tokenAddress}`;
          return (
            <option key={key} value={key}>
              ${market.symbol ?? market.tokenAddress.slice(0, 6)}
            </option>
          );
        })}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
    </div>
  );
}
