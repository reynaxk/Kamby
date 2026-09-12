import { IsString, IsUUID, Matches } from 'class-validator';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Base58-encoded, 64-byte Ed25519 signature — base58 encoding length varies slightly
 *  (leading zero bytes encode shorter), so this is a bounded range, not a fixed length,
 *  same "the real crypto verification is the actual check" reasoning as the EVM
 *  SubmitTransactionDto's txHash pattern. */
const SOLANA_SIGNATURE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export class SolanaSubmitTransactionDto {
  @IsUUID()
  quoteId!: string;

  @Matches(SOLANA_ADDRESS_REGEX, { message: 'walletAddress must be a valid Solana address' })
  walletAddress!: string;

  @IsString()
  @Matches(SOLANA_SIGNATURE_REGEX, { message: 'signature must be a well-formed base58 transaction signature' })
  signature!: string;
}
