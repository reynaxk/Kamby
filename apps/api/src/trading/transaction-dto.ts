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

export function toDto(row: TransactionRow): TradeTransactionDto {
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
    ? row.tokenMarket.quoteToken.decimals!
    : row.side === 'BUY'
      ? row.tokenMarket.token.decimals!
      : row.tokenMarket.quoteToken.decimals!;

  return {
    id: row.id,
    chainId: row.chainId,
    txHash: row.txHash,
    side: row.side as 'BUY' | 'SELL',
    token: { address: row.tokenMarket.token.contractAddress, symbol: row.tokenMarket.token.symbol, decimals: row.tokenMarket.token.decimals! },
    quoteToken: {
      address: row.tokenMarket.quoteToken.contractAddress,
      symbol: row.tokenMarket.quoteToken.symbol,
      decimals: row.tokenMarket.quoteToken.decimals!,
    },
    inputAmount: row.inputAmount,
    expectedOutputAmount: row.expectedOutputAmount,
    inputAmountFormatted: formatUnits(
      BigInt(row.inputAmount),
      row.side === 'BUY' ? row.tokenMarket.quoteToken.decimals! : row.tokenMarket.token.decimals!,
    ),
    expectedOutputAmountFormatted: formatUnits(
      BigInt(row.expectedOutputAmount),
      row.side === 'BUY' ? row.tokenMarket.token.decimals! : row.tokenMarket.quoteToken.decimals!,
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
