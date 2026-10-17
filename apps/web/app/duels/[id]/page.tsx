import { notFound } from 'next/navigation';
import { DuelArena } from '@/components/duels/DuelArena';

export const metadata = { title: 'Duel — Kamby' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A ⚔️ duel's arena (2026-10-17) — anyone with the link can watch. */
export default function DuelPage({ params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) notFound();
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <DuelArena id={params.id} />
    </div>
  );
}
