import { CheckCircle2 } from 'lucide-react';
import { formatCompactUsd, type MockToken } from './mock-data';

/** Top metrics strip in the terminal preview's center column — see PreviewBanner: the
 *  numbers here belong to the selected mock token, not a live feed. */
export function TokenMetricsBar({ token }: { token: MockToken }) {
  const isUp = token.gainPct >= 0;
  const priceUsd = token.marketCapUsd / 1_000_000_000;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full font-display text-xs font-bold text-black"
          style={{ backgroundColor: `hsl(${token.avatarHue} 85% 60%)` }}
        >
          {token.avatarInitial}
        </span>
        <span className="font-display text-base font-bold text-ink-900">${token.ticker}</span>
      </div>
      <Metric label="Price" value={`$${priceUsd.toFixed(6)}`} />
      <Metric label="Mkt Cap" value={formatCompactUsd(token.marketCapUsd)} />
      <Metric label="24h Vol" value={formatCompactUsd(token.marketCapUsd * 0.31)} />
      <Metric label="Liquidity" value={formatCompactUsd(token.marketCapUsd * 0.09)} />
      <Metric label="24h" value={`${isUp ? '+' : ''}${token.gainPct.toFixed(1)}%`} valueClassName={isUp ? 'text-up' : 'text-down'} />
      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-up/10 px-2 py-1 font-mono text-[0.65rem] font-semibold text-up">
        <CheckCircle2 className="h-3 w-3" />
        LP Burned
      </span>
    </div>
  );
}

function Metric({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`font-mono text-sm font-semibold ${valueClassName ?? 'text-ink-900'}`}>{value}</div>
    </div>
  );
}
