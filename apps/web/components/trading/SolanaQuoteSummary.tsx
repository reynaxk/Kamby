import type { SolanaTradeQuoteDto } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { GlowValue } from '@/components/market/GlowValue';
import { formatTokenAmount } from '@/lib/solana-mint';

const USDC_DECIMALS = 6;

function usdcDisplay(raw: string): string {
  return `$${(Number(raw) / 10 ** USDC_DECIMALS).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function impactSeverity(bps: number | null): 'normal' | 'warn' | 'high' {
  if (bps === null) return 'normal';
  if (bps >= 300) return 'high';
  if (bps >= 100) return 'warn';
  return 'normal';
}

const IMPACT_CLASS: Record<ReturnType<typeof impactSeverity>, string> = {
  normal: 'text-ink-900',
  warn: 'text-warn',
  high: 'text-down',
};

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
  compact = false,
  tokenSymbol = null,
  tokenDecimals = null,
}: {
  quote: SolanaTradeQuoteDto;
  compact?: boolean;
  tokenSymbol?: string | null;
  tokenDecimals?: number | null;
}) {
  const tokenDisplay = (raw: string) => formatTokenAmount(raw, tokenDecimals, tokenSymbol);
  const isBuy = quote.side === 'BUY';
  const severity = impactSeverity(quote.priceImpactBps);
  const impactLabel = quote.priceImpactBps === null ? '—' : `${(quote.priceImpactBps / 100).toFixed(2)}%`;
  // Every Solana trade is gas-sponsored, and a sponsored quote's fee is always USDC raw: on a
  // buy it's Kamby's own USDC transfer, on a sell Jupiter's fee on the USDC output (2026-10-04).
  // (Jupiter's own buy fee was in the bought token — a $5 BONK buy once read "$2,662.18".)
  // A buy's inputAmountRaw is only what's swapped — the user pays that plus the fee and any setup charge.
  const feeDisplay = !quote.platformFeeAmountRaw || quote.platformFeeBps === 0 ? '—' : usdcDisplay(quote.platformFeeAmountRaw);

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs text-ink-600">
        <span className="text-ink-400">→</span>
        {isBuy ? (
          <GlowValue value={quote.outputAmountRaw} display={tokenDisplay(quote.outputAmountRaw)} className="font-semibold" />
        ) : (
          <GlowValue value={quote.outputAmountRaw} display={usdcDisplay(quote.outputAmountRaw)} className="font-semibold" />
        )}
        <span className="text-ink-400">•</span>
        <span className={IMPACT_CLASS[severity]}>{impactLabel} impact</span>
        <span className="text-ink-400">•</span>
        <span>
          {feeDisplay} fee
        </span>
        {quote.setupFeeAmountRaw && (
          <>
            <span className="text-ink-400">•</span>
            <span title="First buy of this coin: opens its token account in your wallet">+{usdcDisplay(quote.setupFeeAmountRaw)} new coin setup</span>
          </>
        )}
      </div>
    );
  }

  return (
    <dl className="space-y-2 rounded-xl border border-line bg-surface-raised p-3 font-body text-sm">
      <Row
        label="You pay"
        value={isBuy ? usdcDisplay(buyTotalRaw(quote)) : tokenDisplay(quote.inputAmountRaw)}
        numericValue={quote.inputAmountRaw}
      />
      <Row
        label="You receive"
        value={isBuy ? tokenDisplay(quote.outputAmountRaw) : usdcDisplay(quote.outputAmountRaw)}
        numericValue={quote.outputAmountRaw}
      />
      <Row
        label="Minimum received"
        value={isBuy ? tokenDisplay(quote.minOutputAmountRaw) : usdcDisplay(quote.minOutputAmountRaw)}
        numericValue={quote.minOutputAmountRaw}
      />
      <Row label="Price impact" value={impactLabel} valueClassName={IMPACT_CLASS[severity]} />
      <Row label="Kamby fee" value={feeDisplay} />
      {quote.setupFeeAmountRaw && (
        // Gasless first buy of a coin: the token account Kamby opens in the user's wallet.
        <Row label="New coin setup (first buy only)" value={usdcDisplay(quote.setupFeeAmountRaw)} />
      )}
      <Row label="Provider" value="Jupiter" />
    </dl>
  );
}

function Row({
  label,
  value,
  numericValue,
  valueClassName,
}: {
  label: string;
  value: string;
  numericValue?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className={cn('font-mono', valueClassName ?? 'text-ink-900')}>
        {numericValue !== undefined ? <GlowValue value={numericValue} display={value} /> : value}
      </dd>
    </div>
  );
}
