import { MarketHeader } from '@/components/market/MarketHeader';
import { TradeHistoryList } from '@/components/trading/TradeHistoryList';
import { useTranslations } from 'next-intl';
import { AppBackBar } from '@/components/layout/AppBackBar';

export const metadata = { title: 'Your trades — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/**
 * Entirely client-rendered below the header — trade history is personal to whatever
 * session/wallet this browser has (see docs/TRADING.md#authorization), which a Server
 * Component structurally cannot see (the session lives in localStorage, never a cookie).
 * Void-themed as of the visual overhaul — every page runs kamby-void now.
 */
export default function TradesPage() {
  const tU = useTranslations('ui');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={tU('yourTrades_1344')} fallback="/account" />
      <main className="mx-auto max-w-2xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-xl font-bold text-ink-900 max-md:hidden">{tU('yourTrades_1344')}</h1>
        <p className="mt-1 font-body text-sm text-ink-600">{tU('onlyTradesMadeFromA_6c7d')}</p>
        <div className="mt-6">
          <TradeHistoryList />
        </div>
      </main>
    </div>
  );
}
