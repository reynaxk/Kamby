import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Distinct from SolanaSubmitTransactionDto: the caller hasn't broadcast anything yet here
 *  — the relayer does that — so this carries the partially-signed transaction bytes
 *  themselves (base64), never a signature string. See GasRelayerService's own doc comment.
 *  1232 bytes is Solana's real on-chain transaction size cap; base64-encoded that's ~1644
 *  characters — 4096 leaves real headroom without being unbounded. */
export class SolanaSubmitSponsoredTransactionDto {
  @IsUUID()
  quoteId!: string;

  @Matches(SOLANA_ADDRESS_REGEX, { message: 'walletAddress must be a valid Solana address' })
  walletAddress!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  partiallySignedTxBase64!: string;
}
