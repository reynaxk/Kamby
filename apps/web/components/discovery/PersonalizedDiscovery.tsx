'use client';

import { type PersonalizedToken, slugForIdentifier } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { PriceChange } from '@/components/market/PriceChange';
import { Skeleton } from '@/components/market/Skeleton';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { formatCompactUsd, formatPrice } from '@/lib/format';
import { fetchPersonalizedDiscovery, hasStoredSession } from '@/lib/discovery-client';
import { ReasonTag } from './ReasonTag';
import { useTranslations } from 'next-intl';

/**
 * Tokens picked for this specific viewer — see docs/TRADER_INTELLIGENCE.md#personalization.
 * Renders nothing at all for a browser with no session (this section simply doesn't exist
 * for an anonymous visitor, who continues seeing the public discovery sections instead —
 * see docs/TRADER_INTELLIGENCE.md#personalized-feed for why that's a deliberate choice,
 * not a degraded state).
 */
export function PersonalizedDiscovery() {
  const tU = useTranslations('ui');
  const [state, setState] = useState<'no-session' | 'loading' | 'loaded' | 'error'>('loading');
  const [items, setItems] = useState<PersonalizedToken[]>([]);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    fetchPersonalizedDiscovery(8)
      .then((result) => {
        setItems(result);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'no-session' || state === 'error') return null;

  if (state === 'loading') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={tU('nothingPersonalizedYet_d1b0')}
        detail="Follow a trader or make a trade to start seeing picks tailored to you."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <PersonalizedItem
          key={`${item.market.chainIdentifier}:${item.market.tokenAddress}`}
          item={item}
        />
      ))}
    </div>
  );
}

function PersonalizedItem({ item }: { item: PersonalizedToken }) {
  const tU = useTranslations('ui');
  const chainSlug = slugForIdentifier(item.market.chainIdentifier);
  const content = (
    <Surface className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-accent/50 hover:bg-surface-raised">
      <TokenIdentity
        symbol={item.market.symbol}
        name={item.market.name}
        logoUrl={item.market.logoUrl}
      />
      <div className="flex items-end justify-between gap-2">
        <div className="font-mono text-lg font-semibold tabular-nums text-ink-900">
          {formatPrice(item.market.priceUsd)}
        </div>
        <PriceChange value={item.market.priceChange24hPct} />
      </div>
      <div className="font-mono text-xs tabular-nums text-ink-600">
        Volume {formatCompactUsd(item.market.volume24hUsd)}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
        {item.reasons.map((reason) => (
          <ReasonTag key={reason} reason={reason} />
        ))}
      </div>
    </Surface>
  );

  if (!chainSlug) {
    return (
      <div title={tU('thisMarketIsVisibleFor_626f')}>
        {content}
      </div>
    );
  }

  return (
    <Link href={`/market/${chainSlug}/${item.market.tokenAddress}`} className="block">
      {content}
    </Link>
  );
}
