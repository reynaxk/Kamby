import { Suspense } from 'react';
import { emptyMarketFeeds, type MarketFeedSnapshot } from '@kamby/domain';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { TrenchesBoard } from '@/components/discovery/TrenchesBoard';
import { fetchMarketFeeds } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Hunt — Kamby' };

/** Rows per column the server sends (2026-11-04 speed pass): a screen's worth. The live stream
 *  delivers the full lists the moment it connects, so nothing is lost — the page just stops
 *  shipping a 1.8 MB HTML document with ~270 coins nobody has scrolled to yet. */
const FIRST_PAINT_ROWS = 18;

function firstScreen(feeds: MarketFeedSnapshot): MarketFeedSnapshot {
  const tokens = feeds.xxxrisk?.tokens ?? [];
  const perColumn = new Map<string, number>();
  const kept = tokens.filter((t) => {
    const n = perColumn.get(t.column ?? 'new') ?? 0;
    perColumn.set(t.column ?? 'new', n + 1);
    return n < FIRST_PAINT_ROWS;
  });
  return {
    ...emptyMarketFeeds(),
    crypto: feeds.crypto,
    xxxrisk: { ...feeds.xxxrisk, tokens: kept },
    trending: { ...feeds.trending, markets: (feeds.trending?.markets ?? []).slice(0, 20) },
  };
}

async function LiveBoard() {
  const feeds = await soft(fetchMarketFeeds(), null);
  return <TrenchesBoard initial={feeds ? firstScreen(feeds) : emptyMarketFeeds()} />;
}

/**
 * Hunt (2026-11-01, owner: first XXXRisk, then Trenches, then "rename it to Hunt"): the launchpad board — New, Almost bonded
 * and Migrated across every launchpad and chain, with the full filter panel — as Kamby's start
 * page. /home, /terminal and /trenches redirect here. The page shell paints at once and the
 * board streams in behind a placeholder (2026-11-04: the first coin took 7.5s on a cold load).
 */
export default function HuntPage() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="hidden md:block">
        <MarketHeader />
      </div>
      <PageTopBar />
      <main className="mx-auto max-w-[1680px] pb-28 md:px-5 md:pt-4 md:pb-10">
        {/* No greeting line (Kamby Prime, 2026-11-04): the board starts right under the tabs. */}
        <Suspense fallback={<BoardPlaceholder />}>
          <LiveBoard />
        </Suspense>
      </main>
    </div>
  );
}

/** Three column outlines with row shapes, the same size as the real board. */
function BoardPlaceholder() {
  return (
    <div className="mx-3 mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((c) => (
        <div key={c} className={c ? 'hidden overflow-hidden rounded-xl border border-line bg-[#0A0B0E] lg:block' : 'overflow-hidden rounded-xl border border-line bg-[#0A0B0E]'}>
          <div className="h-[88px] border-b border-line" />
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-[78px] items-center gap-3 border-b border-white/[0.04] px-3">
              <span className="h-[46px] w-[46px] shrink-0 animate-pulse rounded-xl bg-white/[0.04]" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3 w-2/5 animate-pulse rounded bg-white/[0.05]" />
                <span className="h-2.5 w-3/5 animate-pulse rounded bg-white/[0.03]" />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
