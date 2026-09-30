import { cn } from '@kamby/ui';

export const NEW_LISTING_RISK_TEXT =
  'New listing, high risk: found automatically, not hand-picked. It passed liquidity, real two-sided trading and lookalike checks only — there is no rug-pull or honeypot detection.';

/** The "New · high risk" marker for discovered (non-vetted) coins — see FeedMarket.listing. */
export function NewListingBadge({ className }: { className?: string }) {
  return (
    <span
      title={NEW_LISTING_RISK_TEXT}
      className={cn('inline-block rounded-sm bg-warn/15 px-1 font-mono text-[0.5rem] font-bold uppercase tracking-wide text-warn', className)}
    >
      New
    </span>
  );
}
