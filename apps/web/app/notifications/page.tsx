import { MarketHeader } from '@/components/market/MarketHeader';
import { NotificationsPageClient } from '@/components/notifications/NotificationsPageClient';
import { useTranslations } from 'next-intl';
import { AppBackBar } from '@/components/layout/AppBackBar';

export const metadata = { title: 'Notifications — Kamby' };
// See app/solana/page.tsx's own comment — same wagmi/Privy build-time prerender crash,
// same fix: this page has no meaningful static version anyway.
export const dynamic = 'force-dynamic';

/**
 * Entirely client-rendered below the header, same reasoning as app/trades/page.tsx:
 * notifications are personal to whatever session this browser has, which a Server
 * Component structurally cannot see. See docs/NOTIFICATIONS.md. Void-themed as of the
 * visual overhaul.
 */
export default function NotificationsPage() {
  const tU = useTranslations('ui');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={tU('notifications_a274')} fallback="/account" />
      <main className="mx-auto max-w-2xl px-6 py-10 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-xl font-bold text-ink-900 max-md:hidden">{tU('notifications_a274')}</h1>
        <p className="mt-1 font-body text-sm text-ink-600">{tU('followsLikesAndTradeAlerts_0760')}</p>
        <div className="mt-6">
          <NotificationsPageClient />
        </div>
      </main>
    </div>
  );
}
