import { MarketHeader } from '@/components/market/MarketHeader';
import { WatchlistView } from '@/components/watchlist/WatchlistView';
import { useTranslations } from 'next-intl';
import { AppBackBar } from '@/components/layout/AppBackBar';

export const metadata = { title: 'Your watchlist — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/**
 * Entirely client-rendered below the header — a watchlist is personal to whatever session
 * this browser has (see docs/PHASE6_RETENTION_SOCIAL.md#watchlists), which a Server Component
 * structurally cannot see (the session lives in localStorage, never a cookie). "These are the
 * things I care about right now" — see docs/PHASE6_RETENTION_SOCIAL.md#web-ux. Void-themed
 * as of the visual overhaul.
 */
export default function WatchlistPage() {
  const tU = useTranslations('ui');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={tU('yourWatchlist_38e2')} fallback="/account" />
      <main className="mx-auto max-w-2xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-xl font-bold text-ink-900 max-md:hidden">{tU('yourWatchlist_38e2')}</h1>
        <p className="mt-1 font-body text-sm text-ink-600">{tU('tokensYouReTrackingNewest_f31d')}</p>
        <div className="mt-6">
          <WatchlistView />
        </div>
      </main>
    </div>
  );
}
