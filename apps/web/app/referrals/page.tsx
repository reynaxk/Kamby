import { MarketHeader } from '@/components/market/MarketHeader';
import { ReferralsView } from '@/components/referrals/ReferralsView';
import { useTranslations } from 'next-intl';
import { AppBackBar } from '@/components/layout/AppBackBar';

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
  const tU = useTranslations('ui');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={tU('referrals_14ea')} fallback="/account" />
      <main className="mx-auto max-w-2xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-xl font-bold text-ink-900 max-md:hidden">{tU('referrals_14ea')}</h1>
        <p className="mt-1 font-body text-sm text-ink-600">{tU('shareKambyEarnAShare_5fa0')}</p>
        <div className="mt-6">
          <ReferralsView />
        </div>
      </main>
    </div>
  );
}
