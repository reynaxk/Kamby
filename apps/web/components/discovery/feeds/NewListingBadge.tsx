import { cn } from '@kamby/ui';
import { useTranslations } from 'next-intl';

export const NEW_LISTING_RISK_TEXT =
  'New listing, high risk: found automatically, not hand-picked. It passed liquidity, real two-sided trading and lookalike checks only — there is no rug-pull or honeypot detection.';

/** The "New · high risk" marker for discovered (non-vetted) coins — see FeedMarket.listing. */
export function NewListingBadge({ className }: { className?: string }) {
  const tU = useTranslations('ui');
  return (
    <span
      title={NEW_LISTING_RISK_TEXT}
      className={cn(
        'inline-block rounded-sm bg-warn/15 px-1 font-mono text-[0.5rem] font-bold uppercase tracking-wide text-warn',
        // Phones (2026-10-12, minimal): a quiet amber dot instead of a box on every row.
        'max-md:h-1.5 max-md:w-1.5 max-md:rounded-full max-md:bg-warn max-md:p-0',
        className,
      )}
    >
      <span className="max-md:sr-only">{tU('new_03c2')}</span>
    </span>
  );
}
