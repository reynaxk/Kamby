import { IsString, Matches } from 'class-validator';

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

/** Records the separate USDC fee-transfer transaction alongside an already-submitted
 *  trade — see docs/TRADING.md#guaranteed-usdc-fees. The transaction id comes from the
 *  route, not the body: this always attaches to one specific, already-known trade. */
export class SubmitFeeTransactionDto {
  @IsString()
  @Matches(TX_HASH_REGEX, { message: 'txHash must be a well-formed 32-byte transaction hash' })
  txHash!: string;
}
