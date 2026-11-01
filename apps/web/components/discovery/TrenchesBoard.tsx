'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MarketFeedSnapshot } from '@kamby/domain';
import { XxxRiskBoard } from './feeds/XxxRiskBoard';
import { useMarketFeeds } from '@/lib/market-feeds';

/** The launchpad board on its own page, live from the market stream (2026-11-01). */
export function TrenchesBoard({ initial }: { initial: MarketFeedSnapshot }) {
  const tU = useTranslations('ui');
  const { feeds } = useMarketFeeds(initial);
  // Ages tick from the clock, so the board renders after hydration (server and browser agree).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      {!mounted ? <div className="h-[70vh] rounded-2xl bg-white/[0.02]" /> : <XxxRiskBoard tokens={feeds.xxxrisk?.tokens ?? []} emptyText={tU('nothingInRangeRightNow_ba3c')} />}
    </>
  );
}
