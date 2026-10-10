'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { FollowButton } from './FollowButton';
import { useTranslations } from 'next-intl';

/**
 * The trader page's main action: "Edit profile" on your own page (following yourself makes
 * no sense, and this is where people look for it), "Follow" on everyone else's. Decided
 * client-side — the page is server-rendered and can't see which wallet is signed in.
 */
export function TraderProfileActions({ address, initialFollowing }: { address: string; initialFollowing: boolean | null }) {
  const tU = useTranslations('ui');
  const { address: me } = useAccount();
  if (me && me.toLowerCase() === address.toLowerCase()) {
    return (
      <Link
        href="/account#profile"
        className="rounded-lg border border-line px-4 py-2 font-body text-sm font-semibold text-ink-900 hover:bg-surface-raised"
      >
        {tU('editProfile_dfd8')}
      </Link>
    );
  }
  return <FollowButton address={address} initialFollowing={initialFollowing} />;
}
