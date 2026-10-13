import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

const CHAINS = ['base', 'bnb', 'solana'] as const;

export class BridgeQuoteDto {
  @IsIn(CHAINS)
  from!: (typeof CHAINS)[number];

  @IsIn(CHAINS)
  to!: (typeof CHAINS)[number];

  /** Raw USDC that must arrive on `to` (that chain's own decimals). */
  @Matches(/^\d{1,30}$/)
  amountOut!: string;
}

export class SubmitSolanaMoveDto {
  @Matches(/^0x[0-9a-fA-F]{64}$/)
  requestId!: string;

  @IsString()
  @MaxLength(4000)
  signedTxBase64!: string;
}
