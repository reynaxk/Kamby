import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { TRADING_DEFAULTS } from '@kamby/domain';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class SolanaQuoteDto {
  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  /** The non-USDC side of the pair — see SolanaQuoteService's own doc comment on why
   *  USDC is a fixed anchor rather than an arbitrary inputMint/outputMint pair. */
  @Matches(SOLANA_ADDRESS_REGEX, { message: 'tokenMint must be a valid Solana mint address' })
  tokenMint!: string;

  @Matches(SOLANA_ADDRESS_REGEX, { message: 'walletAddress must be a valid Solana address' })
  walletAddress!: string;

  /** A decimal string, denominated in the input token for this side — never parsed as a
   *  JS number, same convention as the EVM QuoteQueryDto. */
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'amount must be a positive decimal number' })
  amount!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(TRADING_DEFAULTS.minSlippageBps)
  @Max(TRADING_DEFAULTS.maxSlippageBps)
  slippageBps: number = TRADING_DEFAULTS.defaultSlippageBps;

  /** Lamports for Jupiter's own built-in Jito tip instruction (`prioritizationFeeLamports.
   *  jitoTipLamports` on their /swap call) — the user's own wallet pays this as part of the
   *  same transaction it already signs, never a backend-sponsored amount. Optional and
   *  0 by default: nothing about Jito submission is forced on. Capped at 10_000_000 lamports
   *  (0.01 SOL) — the top of the priority range this was scoped against; a larger tip needs
   *  a deliberate config change, not a client-supplied number without an upper bound. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  jitoTipLamports: number = 0;
}
