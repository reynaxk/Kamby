import { getTranslations } from 'next-intl/server';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { MarketHeader } from '@/components/market/MarketHeader';
import { LiveList } from '@/components/live/LiveList';

export const metadata = { title: 'Live — Kamby' };

/** Everyone streaming right now (2026-10-30 redesign) — the Live item in the desktop menu. */
export default async function LivePage() {
  const t = await getTranslations('live');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <AppBackBar title={t('liveNow')} fallback="/home" />
      <main className="mx-auto max-w-6xl px-4 pb-16 md:px-6 md:pt-6">
        <LiveList />
      </main>
    </div>
  );
}
