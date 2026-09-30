import { AlertTriangle } from 'lucide-react';
import { NEW_LISTING_RISK_TEXT } from '@/components/discovery/feeds/NewListingBadge';

/** Shown on the trade page of any coin Kamby found automatically rather than hand-picked. */
export function NewListingBanner() {
  return (
    <div role="note" className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 font-body text-xs text-ink-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
      <p>{NEW_LISTING_RISK_TEXT} Only trade what you can afford to lose.</p>
    </div>
  );
}
