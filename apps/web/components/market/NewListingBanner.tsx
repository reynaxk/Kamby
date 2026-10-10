import { AlertTriangle } from 'lucide-react';
import { NEW_LISTING_RISK_TEXT } from '@/components/discovery/feeds/NewListingBadge';
import { useTranslations } from 'next-intl';

/** Shown on the trade page of any coin Kamby found automatically rather than hand-picked. */
export function NewListingBanner({ onBondingCurve = false }: { onBondingCurve?: boolean } = {}) {
  const tU = useTranslations('ui');
  return (
    <div role="note" className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 font-body text-xs text-ink-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
      <p>
        {onBondingCurve
          ? "Still on its launchpad's bonding curve — extremely early. Prices move very fast and most of these coins go to zero."
          : NEW_LISTING_RISK_TEXT}{' '}
        {tU('onlyTradeWhatYouCan_4c7c')}
      </p>
    </div>
  );
}
