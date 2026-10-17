import { notFound } from 'next/navigation';
import { DmThread } from '@/components/dm/DmThread';
import { MessagesShell } from '@/components/dm/MessagesShell';

export const metadata = { title: 'Chat — Kamby' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One private chat (2026-10-17) — client-rendered, it's personal to the session. On a computer
 *  it sits next to the chat list. */
export default function MessageThreadPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  return (
    <MessagesShell>
      <DmThread id={params.id} />
    </MessagesShell>
  );
}
