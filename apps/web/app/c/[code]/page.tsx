import { notFound } from 'next/navigation';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { InviteJoin } from '@/components/dm/CommunityBits';

export const metadata = { title: 'Join a community — Kamby' };
export const dynamic = 'force-dynamic';

/** A community invite link, kambesh.com/c/<code> (2026-10-17). */
export default function CommunityInvitePage({ params }: { params: { code: string } }) {
  if (!/^[a-z0-9]{6,16}$/i.test(params.code)) notFound();
  return (
    <div className="kamby-void min-h-screen bg-bg pb-28">
      <AppBackBar title="" fallback="/messages" />
      <div className="px-4">
        <InviteJoin code={params.code.toLowerCase()} />
      </div>
    </div>
  );
}
