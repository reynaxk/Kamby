import { getTranslations } from 'next-intl/server';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { DmInbox } from '@/components/dm/DmInbox';
import { MessagesShell } from '@/components/dm/MessagesShell';

export const metadata = { title: 'Messages — Kamby' };
// Personal to this browser's session, like /notifications — nothing to prerender.
export const dynamic = 'force-dynamic';

/** Private messages (2026-10-17): your chats and message requests. On a computer the chat list
 *  is the left pane (MessagesShell) and the right pane waits for a chat. */
export default async function MessagesPage() {
  const t = await getTranslations('dm');
  return (
    <MessagesShell
      home={
        <div className="pb-28">
          <AppBackBar title={t('title')} fallback="/home" />
          <main className="mx-auto max-w-2xl px-4 pt-2">
            <DmInbox />
          </main>
        </div>
      }
    >
      {null}
    </MessagesShell>
  );
}
