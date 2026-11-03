'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MarketFeedSnapshot } from '@kamby/domain';
import { XxxRiskBoard } from './feeds/XxxRiskBoard';
import { HuntSidePanel } from './HuntSidePanel';
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
      {/* Wide screens: the trending list and Pulse chat on the left (2026-11-02, the approved canvas). */}
      <div className="flex items-start gap-3">
        {mounted && <HuntSidePanel trending={feeds.trending?.markets ?? []} />}
        <div className="min-w-0 flex-1">
          {!mounted ? <div className="h-[70vh] rounded-2xl bg-white/[0.02]" /> : <XxxRiskBoard tokens={feeds.xxxrisk?.tokens ?? []} emptyText={tU('nothingInRangeRightNow_ba3c')} />}
        </div>
      </div>
    </>
  );
}
