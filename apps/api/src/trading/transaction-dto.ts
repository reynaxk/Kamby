import type { Prisma } from '@kamby/db';
import type { TradeTransactionDto } from '@kamby/domain';
import { formatUnits } from 'viem';

/**
 * Shared by `TransactionService` and `EvmGasRelayerQuoteService` — pulled out of
 * `transaction.service.ts` specifically to avoid a circular import: the relayer service
 * needs `toDto`/`TRANSACTION_INCLUDE` to persist and return a sponsored trade the same way
 * a self-paid one is, and `TransactionService` needs the relayer service (to trigger the
 * fee leg once a sponsored trade's swap confirms — see `EvmGasRelayerQuoteService
 * #submitFeeLegIfDue`'s own doc comment). Neither direction should import the other
 * directly; both import this instead.
 */
export const TRANSACTION_INCLUDE = {
  tokenMarket: { include: { token: true, quoteToken: true } },
  quote: true,
} as const;

export type TransactionRow = Prisma.TradeTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

/** USDC's decimals per chain — fixed by each token contract. Trades pay and sell into USDC
 *  (since 2026-10-02) whatever the pool's own pair token is — see QuoteService#createQuote. */
const USDC_DECIMALS_BY_CHAIN_ID: Record<number, number> = { 8453: 6, 42161: 6, 1: 6, 56: 18 };

/** The trade's USDC/pair side ("pay with" on a buy, "receive" on a sell): the token actually
 *  traded, as stored on the transaction — the pool's pair token for older trades, USDC after. */
function paySideToken(row: TransactionRow): { address: string; symbol: string | null; decimals: number } {
  const address = row.side === 'BUY' ? row.inputToken : row.outputToken;
  const pair = row.tokenMarket.quoteToken;
  if (!address || address.toLowerCase() === pair.contractAddress.toLowerCase()) {
    return { address: pair.contractAddress, symbol: pair.symbol, decimals: pair.decimals! };
  }
  return { address, symbol: 'USDC', decimals: USDC_DECIMALS_BY_CHAIN_ID[row.chainId] ?? pair.decimals! };
}

export function toDto(row: TransactionRow): TradeTransactionDto {
  const payToken = paySideToken(row);
  // Whether this trade's fee rides a separate, guaranteed-USDC transfer (see
  // docs/TRADING.md#guaranteed-usdc-fees) — the quote's own feeUnsignedTx is the single
  // source of truth for this, set once at quote time and never re-derived from the side or
  // token addresses again here.
  const usesGuaranteedUsdcFee = row.quote.feeUnsignedTx !== null;
  // Under the guaranteed flow the fee is always in market.quoteToken (USDC) — for a BUY
  // that's the *input* token, not the token.decimals the non-guaranteed convention below
  // uses for its output-side fee. Everywhere else, unchanged: fee formats with the output
  // token's decimals, matching the aggregator's own embedded-fee convention.
  const feeDecimals = usesGuaranteedUsdcFee
    ? payToken.decimals
    : row.side === 'BUY'
      ? row.tokenMarket.token.decimals!
      : payToken.decimals;

  return {
    id: row.id,
    chainId: row.chainId,
    txHash: row.txHash,
    side: row.side as 'BUY' | 'SELL',
    token: { address: row.tokenMarket.token.contractAddress, symbol: row.tokenMarket.token.symbol, decimals: row.tokenMarket.token.decimals! },
    quoteToken: payToken,
    inputAmount: row.inputAmount,
    expectedOutputAmount: row.expectedOutputAmount,
    inputAmountFormatted: formatUnits(
      BigInt(row.inputAmount),
      row.side === 'BUY' ? payToken.decimals : row.tokenMarket.token.decimals!,
    ),
    expectedOutputAmountFormatted: formatUnits(
      BigInt(row.expectedOutputAmount),
      row.side === 'BUY' ? row.tokenMarket.token.decimals! : payToken.decimals,
    ),
    platformFeeAmount: row.platformFeeAmount,
    platformFeeAmountFormatted: formatUnits(BigInt(row.platformFeeAmount), feeDecimals),
    status: row.status,
    failureReason: row.failureReason,
    submittedAt: row.submittedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    feeTxHash: row.feeTxHash,
    feeStatus: row.feeStatus,
    feeFailureReason: row.feeFailureReason,
    feeConfirmedAt: row.feeConfirmedAt ? row.feeConfirmedAt.toISOString() : null,
    sponsoredByRelayer: row.sponsoredByRelayer,
    relayerFeePayer: row.relayerFeePayer,
  };
}
