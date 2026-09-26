import { MarketHeader } from '@/components/market/MarketHeader';
import { ProfileEditor } from '@/components/account/ProfileEditor';
import { PnlHistoryChart } from '@/components/discovery/PnlHistoryChart';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';

export const metadata = { title: 'Your profile — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/** Entirely client-rendered below the header, same reasoning as app/watchlist/page.tsx:
 *  the session lives in localStorage, invisible to a Server Component. Void-themed as of
 *  the visual overhaul — every page runs kamby-void now, not just the trading-facing ones. */
export default function AccountPage() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-ink-900">Your profile</h1>
            <p className="mt-1 font-body text-sm text-ink-600">
              Your username and picture appear on the leaderboard and your trader profile.
            </p>
          </div>
          <div className="flex gap-2">
            <FundButton variant="labeled" />
            <SendButton variant="labeled" />
          </div>
        </div>
        <div className="mt-6">
          <ProfileEditor />
        </div>
        <div className="mt-8">
          <PnlHistoryChart />
        </div>
      </main>
    </div>
  );
}
