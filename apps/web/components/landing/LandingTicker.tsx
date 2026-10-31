import type { FeedMarket } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { cashtag, formatPercent, formatPrice } from '@/lib/format';
import { TokenAvatar } from '@/components/market/TokenAvatar';

/**
 * Real coins drifting under the hero (2026-10-31, owner: "eye-catching for someone's first look"):
 * Trending right now — logo, price, 24h move — in an endless marquee. Real numbers from the same
 * snapshot the app uses; nothing at all if there's none.
 */
export function LandingTicker({ markets }: { markets: FeedMarket[] }) {
  const coins = markets.filter((m) => m.priceUsd !== null && m.symbol).slice(0, 16);
  if (coins.length < 6) return null;
  const row = (copy: string) =>
    coins.map((m) => {
      const up = (m.priceChange24hPct ?? 0) >= 0;
      return (
        <span
          key={`${copy}:${m.chainIdentifier}:${m.tokenAddress}`}
          className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] py-2 pl-2 pr-3.5"
        >
          <TokenAvatar
            src={m.logoUrl}
            seed={m.tokenAddress}
            label={m.symbol}
            className="h-7 w-7 text-[0.65rem]"
          />
          <span className="font-display text-sm font-bold text-white">
            {cashtag(m.symbol ?? '')}
          </span>
          <span className="font-mono text-xs tabular-nums text-white/70">
            {formatPrice(m.priceUsd)}
          </span>
          <span
            className={cn(
              'font-mono text-xs font-semibold tabular-nums',
              up ? 'text-[#00E676]' : 'text-[#FF3B69]',
            )}
          >
            {formatPercent(m.priceChange24hPct)}
          </span>
        </span>
      );
    });
  return (
    <div className="kamby-marquee-mask relative overflow-hidden" aria-hidden>
      {/* The track holds the row twice, so -50% loops without a seam. */}
      <div className="kamby-marquee flex w-max gap-3 px-1.5 [animation-duration:60s]">
        {row('a')}
        {row('b')}
      </div>
    </div>
  );
}
