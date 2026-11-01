import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { NarrativesView } from '@/components/narratives/NarrativesView';
import { WidgetBoundary } from '@/components/ui-kit/WidgetBoundary';
import { fetchNarratives } from '@/lib/market-api';
import { soft } from '@/lib/soft';

export const metadata = { title: 'Narratives — Kamby' };
// Same wagmi/Privy build-time prerender crash as app/watchlist — nothing static here anyway.
export const dynamic = 'force-dynamic';

/**
 * Narratives (2026-10-31): the stories the market is trading — AI agents, memes by chain, DeFi…
 * — ranked by a Heat Index from real activity, each with its hottest coins one tap from a buy.
 */
export default async function NarrativesPage() {
  const t = await getTranslations('narratives');
  const initial = await soft(fetchNarratives(), null);
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar fallback="/hunt" />
      <main className="mx-auto max-w-[1560px] px-6 py-8 max-md:px-4 max-md:pt-2">
        <WidgetBoundary name="narratives">
          <NarrativesView initial={initial} />
        </WidgetBoundary>
      </main>
    </div>
  );
}
