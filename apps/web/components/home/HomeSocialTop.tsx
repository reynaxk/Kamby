'use client';

import { StoriesRow } from '@/components/stories/Stories';
import { LiveList } from '@/components/live/LiveList';
import { useMediaQuery, XL_QUERY } from '@/lib/use-media';

/**
 * Wide desktop home (2026-10-30 redesign, owner's concepts): the social part on top of the main
 * column — today's stories in a card, then who's live as three cards. Narrower screens keep the
 * stories inside PortfolioHeader, so only one StoriesRow ever loads.
 */
export function HomeSocialTop() {
  const wide = useMediaQuery(XL_QUERY);
  if (!wide) return null;
  return (
    <div className="mb-5 flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface px-4 pb-3 empty:hidden">
        <StoriesRow />
      </div>
      <LiveList strip limit={3} />
    </div>
  );
}
