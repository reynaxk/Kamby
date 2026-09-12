import type { SolanaTradeQuoteDto } from '@kamby/domain';

const USDC_DECIMALS = 6;

function formatUsdc(raw: string): string {
  return `$${(Number(raw) / 10 ** USDC_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Solana's counterpart to QuoteSummary.tsx — deliberately a separate, simpler component,
 * not a shared one: `SolanaTradeQuoteDto` has no `*Formatted` fields (unlike
 * `TradeQuoteDto`) and no token-symbol objects, just raw amounts and mint addresses.
 *
 * Known, honest simplification for launch: the non-USDC leg's amount is shown in raw
 * (pre-decimals) units, not divided by that mint's own decimals — resolving an arbitrary
 * SPL mint's decimals isn't wired up yet (see SolanaQuoteResult's own doc comment). Never
 * silently mislabeled as a formatted dollar/token amount it isn't — the label says "raw
 * units" so nothing here claims more precision than it actually has.
 */
export function SolanaQuoteSummary({ quote }: { quote: SolanaTradeQuoteDto }) {
  const isBuy = quote.side === 'BUY';
  return (
    <dl className="space-y-2 rounded-xl bg-surface-raised p-3 font-body text-sm">
      <Row label="You pay" value={isBuy ? formatUsdc(quote.inputAmountRaw) : `${quote.inputAmountRaw} raw units`} />
      <Row label="You receive" value={isBuy ? `${quote.outputAmountRaw} raw units` : formatUsdc(quote.outputAmountRaw)} />
      <Row label="Minimum received" value={isBuy ? `${quote.minOutputAmountRaw} raw units` : formatUsdc(quote.minOutputAmountRaw)} />
      <Row
        label="Price impact"
        value={quote.priceImpactBps === null ? '—' : `${(quote.priceImpactBps / 100).toFixed(2)}%`}
        valueClassName={quote.priceImpactBps !== null && quote.priceImpactBps >= 300 ? 'text-down' : 'text-ink-900'}
      />
      <Row label={`Kamby fee (${(quote.platformFeeBps / 100).toFixed(2)}%)`} value={quote.platformFeeAmountRaw ? formatUsdc(quote.platformFeeAmountRaw) : '—'} />
      <Row label="Provider" value="Jupiter" />
    </dl>
  );
}

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className={valueClassName ?? 'text-ink-900'}>{value}</dd>
    </div>
  );
}
