import { notFound } from 'next/navigation';
import { DmThread } from '@/components/dm/DmThread';

export const metadata = { title: 'Chat — Kamby' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One private chat (2026-10-17) — client-rendered, it's personal to the session. */
export default function MessageThreadPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <DmThread id={params.id} />
    </div>
  );
}
