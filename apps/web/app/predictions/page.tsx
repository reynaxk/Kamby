import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { PredictionsView } from '@/components/predictions/PredictionsView';
import { WidgetBoundary } from '@/components/ui-kit/WidgetBoundary';

export const metadata = { title: 'Predictions — Kamby' };
// Same wagmi/Privy build-time prerender crash as app/watchlist — nothing static here anyway.
export const dynamic = 'force-dynamic';

/**
 * Predictions (2026-10-31): free community forecasts — vote on what happens next; auto-made
 * polls resolve themselves from real prices. Votes only: no money, no points, no prizes.
 */
export default async function PredictionsPage() {
  const t = await getTranslations('predictions');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={t('title')} fallback="/home" />
      <main className="mx-auto max-w-[1400px] px-6 py-8 max-md:px-4 max-md:pt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink-900 max-md:hidden">
          <span aria-hidden>🎯</span>
          {t('title')}
        </h1>
        <p className="mb-5 mt-1 font-body text-sm text-ink-400">{t('subtitle')}</p>
        <WidgetBoundary name="predictions">
          <PredictionsView />
        </WidgetBoundary>
      </main>
    </div>
  );
}
