import { tradesInChainUsdc, type TradeQuoteDto } from '@kamby/domain';
import { useTranslations } from 'next-intl';
import { formatTradeAmount } from '@/lib/format';

/** "$3.00" for a dollar token, "650.16 BRETT" for a coin — always rounded for people. */
export function tradeAmountLabel(amount: string | number, symbol: string | null): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  const rounded = formatTradeAmount(Number.isFinite(value) ? value : 0);
  return symbol === 'USDC' || symbol === 'USDG' ? `$${rounded}` : `${rounded} ${symbol ?? ''}`.trim();
}

/**
 * What a trade does, in three lines (owner, 2026-10-18: "only the most important info — amount,
 * final amount, fee", rounded to 2 decimals): you pay, you get, Kamby's fee. Every figure comes
 * straight from the API's quote — nothing is recomputed here. Only a high/extreme price impact
 * adds a line, because that's the one thing that should stop someone.
 */
export function QuoteSummary({ quote }: { quote: TradeQuoteDto }) {
  const tTrade = useTranslations('trade');
  const tL = useTranslations('labels');

  const paySymbol = quote.side === 'BUY' ? quote.quoteToken.symbol : quote.token.symbol;
  const getSymbol = quote.side === 'BUY' ? quote.token.symbol : quote.quoteToken.symbol;
  // The fee is USDC whenever the trade's dollar side is this chain's USDC (inside the swap or
  // as its own transfer); a non-USDC market's aggregator cut lands in what the trade outputs.
  const feeInUsdc =
    Boolean(quote.feeUnsignedTx) ||
    tradesInChainUsdc(quote.chainId, quote.side, quote.side === 'BUY' ? quote.quoteToken.address : null, quote.side === 'SELL' ? quote.quoteToken.address : null);
  const feeSymbol = feeInUsdc ? quote.quoteToken.symbol : getSymbol;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
      <dl className="space-y-2 font-body text-sm">
        <Row label={tTrade('youPay')} value={tradeAmountLabel(quote.inputAmountFormatted, paySymbol)} />
        <Row label={tL('youGet')} value={tradeAmountLabel(quote.expectedOutputAmountFormatted, getSymbol)} strong />
        <Row label={tL('tradeFee')} value={tradeAmountLabel(quote.platformFeeAmountFormatted, feeSymbol)} muted />
      </dl>
      {(quote.priceImpactLevel === 'extreme' || quote.priceImpactLevel === 'high') && (
        <p className="mt-2.5 rounded-lg bg-down/10 px-2.5 py-2 font-body text-xs text-down">
          ⚠ {quote.priceImpactLevel === 'extreme' ? 'Extreme' : 'High'} price impact — this trade may move the market by{' '}
          {((quote.priceImpactBps ?? 0) / 100).toFixed(1)}%.
          {quote.priceImpactLevel === 'extreme' && ' Consider a smaller amount.'}
        </p>
      )}
    </div>
  );
}

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-400">{label}</dt>
      <dd className={strong ? 'font-display text-base font-bold tabular-nums text-ink-900' : muted ? 'tabular-nums text-ink-600' : 'tabular-nums text-ink-900'}>{value}</dd>
    </div>
  );
}
