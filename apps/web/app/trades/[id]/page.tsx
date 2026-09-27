import Link from 'next/link';
import { MarketHeader } from '@/components/market/MarketHeader';
import { TransactionDetail } from '@/components/trading/TransactionDetail';

export const metadata = { title: 'Trade detail — Kamby' };

/** Void-themed, matching every other page (see /trades/page.tsx's own comment: "every page
 *  runs kamby-void now") — missing here was a real gap, not a deliberate exception: clicking
 *  from the dark trade-history list into one trade's detail landed on the old light/dark
 *  page, a jarring theme switch mid-flow. */
export default function TradeDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/trades" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to your trades
        </Link>
        <div className="mt-4">
          <TransactionDetail id={params.id} />
        </div>
      </main>
    </div>
  );
}
