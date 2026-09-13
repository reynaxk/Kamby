import type { MockToken } from './mock-data';

/** Compact buyer/seller volume split beneath the swap widget — mock data, see
 *  PreviewBanner. Derived deterministically from the token's own gain % (an up token skews
 *  buy-heavy) rather than a separate random number, so it's at least internally consistent. */
export function TokenOverviewCard({ token }: { token: MockToken }) {
  const buyPct = Math.min(85, Math.max(15, 50 + token.gainPct / 4));
  const sellPct = 100 - buyPct;

  return (
    <div className="rounded-lg border border-line bg-surface-raised p-3">
      <div className="flex items-center justify-between font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">
        <span>Buyers {buyPct.toFixed(0)}%</span>
        <span>Sellers {sellPct.toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-up" style={{ width: `${buyPct}%` }} />
        <div className="h-full bg-down" style={{ width: `${sellPct}%` }} />
      </div>
    </div>
  );
}
