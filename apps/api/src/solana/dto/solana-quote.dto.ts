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

  /** Raw integer units (pre-decimals) of the input token for this side — USDC (6 decimals)
   *  for BUY, tokenMint for SELL — passed to Jupiter as-is, never parsed as a JS number.
   *  Unlike the EVM QuoteQueryDto, this is NOT a human decimal: a value like "0.05" used to
   *  pass validation, get rejected by Jupiter with a 400, and surface to the caller as a
   *  misleading "no live quote, try again shortly" 422 (found 2026-09-29). */
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'amount must be a positive integer in raw token units' })
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
