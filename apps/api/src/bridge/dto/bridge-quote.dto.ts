import { IsIn, Matches } from 'class-validator';

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
