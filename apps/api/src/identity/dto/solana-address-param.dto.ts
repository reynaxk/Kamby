import { Matches } from 'class-validator';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Validates the `:address` path param before it reaches any service — a malformed
 *  address 400s here rather than causing a confusing 404 or DB error downstream. */
export class SolanaAddressParamDto {
  @Matches(SOLANA_ADDRESS_REGEX, { message: 'address must be a valid Solana address' })
  address!: string;
}
