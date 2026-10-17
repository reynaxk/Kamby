import { getTranslations } from 'next-intl/server';
import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { DmInbox } from '@/components/dm/DmInbox';

export const metadata = { title: 'Messages — Kamby' };
// Personal to this browser's session, like /notifications — nothing to prerender.
export const dynamic = 'force-dynamic';

/** Private messages (2026-10-17): your chats and message requests. */
export default async function MessagesPage() {
  const t = await getTranslations('dm');
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title={t('title')} fallback="/home" />
      <main className="mx-auto max-w-2xl px-6 py-8 max-md:px-4 max-md:pt-2">
        <h1 className="font-display text-2xl font-black tracking-tight text-ink-900 max-md:hidden">{t('title')}</h1>
        <div className="md:mt-5">
          <DmInbox />
        </div>
      </main>
    </div>
  );
}
