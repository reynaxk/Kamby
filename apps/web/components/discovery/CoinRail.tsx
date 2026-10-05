'use client';

import { useRouter } from 'next/navigation';
import type { MarketFeedSnapshot } from '@kamby/domain';
import { useMarketFeeds } from '@/lib/market-feeds';
import { marketHref, solanaMarketHref } from '@/lib/solana-links';
import { DiscoverTokenList } from './DiscoverTokenList';

/**
 * The terminal's live coin list, as a left rail on a coin page (2026-10-05: clicking a Solana
 * coin in the terminal opened a page with only its chart and trade panel, which felt like the
 * screen "scaling" — the list was gone). Same tabs and live feed as the terminal; picking a
 * coin opens its page with the list still here.
 */
export function CoinRail({ initial, selectedKey }: { initial: MarketFeedSnapshot; selectedKey: string | null }) {
  const router = useRouter();
  const { feeds } = useMarketFeeds(initial);
  return (
    <div className="kamby-terminal h-full overflow-hidden rounded-2xl border border-line bg-surface">
      <DiscoverTokenList
        feeds={feeds}
        selectedKey={selectedKey}
        selectionDisabled={false}
        onSelect={(market) => {
          const href = market.chainIdentifier === 'solana' ? solanaMarketHref(market.tokenAddress) : marketHref(market.chainIdentifier, market.tokenAddress);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}
