import { getTranslations } from 'next-intl/server';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { MarketHeader } from '@/components/market/MarketHeader';
import { Feed } from '@/components/feed/Feed';
import { MarkExplored } from '@/components/home/MarkExplored';
import { WidgetBoundary } from '@/components/ui-kit/WidgetBoundary';

export const metadata = { title: 'Feed — Kamby' };

/** The Feed (2026-10-30, owner's concepts) — what traders post, with their real trades. */
export default async function FeedPage() {
  const t = await getTranslations('feed');
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader search={false} />
      <AppBackBar fallback="/hunt" />
      <main className="mx-auto max-w-2xl px-4 pb-16 md:pt-6">
        <WidgetBoundary name="feed"><Feed /></WidgetBoundary>
        <MarkExplored />
      </main>
    </div>
  );
}
