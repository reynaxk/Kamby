import { notFound } from 'next/navigation';
import { LiveRoomScreen } from '@/components/live/LiveRoomScreen';

export const metadata = { title: 'Live — Kamby' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A live room (2026-10-17). */
export default function LivePage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <LiveRoomScreen id={params.id} />
    </div>
  );
}
