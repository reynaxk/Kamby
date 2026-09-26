import { MarketHeader } from '@/components/market/MarketHeader';
import { ReferralsView } from '@/components/referrals/ReferralsView';

export const metadata = { title: 'Referrals — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/**
 * Entirely client-rendered below the header, same reasoning as app/watchlist/page.tsx: a
 * referral code is tied to whatever session this browser has, which lives in localStorage
 * — structurally invisible to a Server Component. Void-themed as of the visual overhaul.
 */
export default function ReferralsPage() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-xl font-bold text-ink-900">Referrals</h1>
        <p className="mt-1 font-body text-sm text-ink-600">Share Kamby, earn a share of the fees.</p>
        <div className="mt-6">
          <ReferralsView />
        </div>
      </main>
    </div>
  );
}
