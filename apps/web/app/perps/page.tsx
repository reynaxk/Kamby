import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PerpsBlocked } from '@/components/perps/PerpsBlocked';
import { PerpsHome } from '@/components/perps/PerpsHome';
import { perpsBlockedHere } from '@/lib/perps-region';

export const metadata = { title: 'Perps — Kamby' };
export const dynamic = 'force-dynamic';

/** ⚡ Perps on Hyperliquid (2026-10-21). */
export default async function PerpsPage() {
  const t = await getTranslations('perps');
  const blocked = perpsBlockedHere();
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-8 max-md:px-4 max-md:pt-[calc(env(safe-area-inset-top)+1rem)]">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">{t('title')}</h1>
        <p className="mt-1 mb-5 font-body text-sm text-ink-400">{t('sub')}</p>
        {blocked ? <PerpsBlocked /> : <PerpsHome />}
      </main>
    </div>
  );
}
