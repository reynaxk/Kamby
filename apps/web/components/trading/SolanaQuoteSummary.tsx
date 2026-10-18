import type { SolanaTradeQuoteDto } from '@kamby/domain';
import { GlowValue } from '@/components/market/GlowValue';
import { formatTokenAmount } from '@/lib/solana-mint';
import { useTranslations } from 'next-intl';
import { tradeAmountLabel } from './QuoteSummary';

const USDC_DECIMALS = 6;

function impactSeverity(bps: number | null): 'normal' | 'warn' | 'high' {
  if (bps === null) return 'normal';
  if (bps >= 300) return 'high';
  if (bps >= 100) return 'warn';
  return 'normal';
}

/**
 * Solana's counterpart to QuoteSummary.tsx — deliberately a separate, simpler component,
 * not a shared one: `SolanaTradeQuoteDto` has no `*Formatted` fields (unlike
 * `TradeQuoteDto`) and no token-symbol objects, just raw amounts and mint addresses.
 *
 * The non-USDC leg is formatted with `tokenDecimals` (read on-chain by the caller, see
 * useMintDecimals). While that's unknown it falls back to raw (pre-decimals) units, labeled
 * as such — never silently mislabeled as a formatted amount it isn't.
 *
 * `compact` renders a single live-preview line (the "see the output before you click review"
 * ask) — same data as the full breakdown below it, condensed, so a real quote refresh still
 * only glows what actually changed rather than duplicating fetch logic.
 */
/** What a buy actually costs: the swapped USDC plus Kamby's fee and any new-coin setup charge. */
function buyTotalRaw(quote: SolanaTradeQuoteDto): string {
  return (BigInt(quote.inputAmountRaw) + BigInt(quote.platformFeeAmountRaw ?? '0') + BigInt(quote.setupFeeAmountRaw ?? '0')).toString();
}

export function SolanaQuoteSummary({
  quote,
  tokenSymbol = null,
  tokenDecimals = null,
}: {
  quote: SolanaTradeQuoteDto;
  /** Kept for callers; the summary is the same three lines either way now. */
  compact?: boolean;
  tokenSymbol?: string | null;
  tokenDecimals?: number | null;
}) {
  const tTrade = useTranslations('trade');
  const tL = useTranslations('labels');
  // Rounded for people (owner, 2026-10-18) — raw units only while the mint's decimals load.
  const tokenDisplay = (raw: string) =>
    tokenDecimals === null ? formatTokenAmount(raw, tokenDecimals, tokenSymbol) : tradeAmountLabel(Number(raw) / 10 ** tokenDecimals, tokenSymbol);
  const usd = (raw: string) => tradeAmountLabel(Number(raw) / 10 ** USDC_DECIMALS, 'USDC');
  const isBuy = quote.side === 'BUY';
  const severity = impactSeverity(quote.priceImpactBps);
  // Every Solana trade is gas-sponsored, and a sponsored quote's fee is always USDC raw: on a
  // buy it's Kamby's own USDC transfer, on a sell Jupiter's fee on the USDC output (2026-10-04).
  // A first buy of a coin also pays its token-account setup — counted in the one Fee line.
  const feeRaw = BigInt(quote.platformFeeBps === 0 ? '0' : (quote.platformFeeAmountRaw ?? '0')) + BigInt(quote.setupFeeAmountRaw ?? '0');

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
      <dl className="space-y-2 font-body text-sm">
        <Row label={tTrade('youPay')} value={isBuy ? usd(buyTotalRaw(quote)) : tokenDisplay(quote.inputAmountRaw)} numericValue={quote.inputAmountRaw} />
        <Row label={tL('youGet')} value={isBuy ? tokenDisplay(quote.outputAmountRaw) : usd(quote.outputAmountRaw)} numericValue={quote.outputAmountRaw} strong />
        <Row label={tL('tradeFee')} value={feeRaw > 0n ? usd(feeRaw.toString()) : '—'} muted />
      </dl>
      {severity === 'high' && (
        <p className="mt-2.5 rounded-lg bg-down/10 px-2.5 py-2 font-body text-xs text-down">
          ⚠ High price impact — this trade may move the market by {((quote.priceImpactBps ?? 0) / 100).toFixed(1)}%.
        </p>
      )}
    </div>
  );
}

function Row({ label, value, numericValue, strong = false, muted = false }: { label: string; value: string; numericValue?: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-400">{label}</dt>
      <dd className={strong ? 'font-display text-base font-bold tabular-nums text-ink-900' : muted ? 'tabular-nums text-ink-600' : 'tabular-nums text-ink-900'}>
        {numericValue !== undefined ? <GlowValue value={numericValue} display={value} /> : value}
      </dd>
    </div>
  );
}
