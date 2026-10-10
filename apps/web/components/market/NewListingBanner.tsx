import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The high-risk warning on a discovered (not hand-picked) coin's page. `compact` (the phone
 * coin screen, 2026-10-10): one short line that opens to the full text on tap — the full
 * paragraph took a third of the screen above the chart.
 */
export function NewListingBanner({ onBondingCurve = false, compact = false }: { onBondingCurve?: boolean; compact?: boolean } = {}) {
  const tU = useTranslations('ui');
  const tL = useTranslations('labels');
  const full = (
    <>
      {tL(onBondingCurve ? 'riskBondingCurve' : 'riskNewListing')} {tU('onlyTradeWhatYouCan_4c7c')}
    </>
  );
  if (compact) {
    return (
      <details role="note" className="group rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 font-body text-xs text-ink-900">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <span className="flex-1 font-semibold">{tL(onBondingCurve ? 'riskShortBonding' : 'riskShort')}</span>
          <span aria-hidden className="text-ink-400 transition-transform group-open:rotate-180">▾</span>
        </summary>
        <p className="mt-1.5 pl-6 text-ink-600">{full}</p>
      </details>
    );
  }
  return (
    <div role="note" className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 font-body text-xs text-ink-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
      <p>{full}</p>
    </div>
  );
}
