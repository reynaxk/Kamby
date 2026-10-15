import { Matches } from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** Validates the `:address` path param before it reaches any service — a malformed
 *  address 400s here rather than causing a confusing 404 or DB error downstream. */
export class AddressParamDto {
  @Matches(EVM_ADDRESS_REGEX, { message: 'address must be a valid EVM address' })
  address!: string;
}

/** A trader's wallet on any supported chain — EVM (0x…) or Solana (base58). */
export class TraderAddressParamDto {
  @Matches(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, { message: 'address must be a valid EVM or Solana address' })
  address!: string;
}
