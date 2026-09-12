import { Matches } from 'class-validator';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class SolanaWalletChallengeDto {
  @Matches(SOLANA_ADDRESS_REGEX, { message: 'address must be a valid Solana address' })
  address!: string;
}
