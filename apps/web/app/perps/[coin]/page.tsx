import { MarketHeader } from '@/components/market/MarketHeader';
import { PerpsBlocked } from '@/components/perps/PerpsBlocked';
import { PerpsCoinScreen } from '@/components/perps/PerpsCoinScreen';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { perpsBlockedHere } from '@/lib/perps-region';

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { coin: string } }) {
  return { title: `${decodeURIComponent(params.coin)}-PERP — Kamby` };
}

/** ⚡ One perp market (2026-10-21). */
export default function PerpCoinPage({ params }: { params: { coin: string } }) {
  const coin = decodeURIComponent(params.coin);
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <MarketHeader className="max-md:hidden" />
      <main className="mx-auto max-w-2xl px-6 py-6 max-md:px-4 max-md:pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        {perpsBlockedHere() ? (
          <PerpsBlocked />
        ) : (
          <ToastProvider>
            <PerpsCoinScreen coin={coin} />
          </ToastProvider>
        )}
      </main>
    </div>
  );
}
