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
      <MarketHeader search={false} />
      <main className="mx-auto max-w-2xl px-6 py-8 max-md:px-4 max-md:pt-[calc(env(safe-area-inset-top)+1rem)]">
        {blocked ? <PerpsBlocked /> : <PerpsHome />}
      </main>
    </div>
  );
}
