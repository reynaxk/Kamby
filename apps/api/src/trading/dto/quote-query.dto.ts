import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { SUPPORTED_CHAIN_IDS, TRADING_DEFAULTS } from '@kamby/domain';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export class QuoteQueryDto {
  /** Omitted means "whichever chain this deployment defaults to" — see
   *  TradingController.getQuote, which substitutes DEFAULT_CHAIN_ID. Rejected outright
   *  (not silently ignored) when present but not one of this deployment's configured
   *  chains — never guessed at deeper in the stack. */
  @IsOptional()
  @Type(() => Number)
  @IsIn(SUPPORTED_CHAIN_IDS)
  chainId?: number;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @Matches(EVM_ADDRESS_REGEX, { message: 'tokenAddress must be a valid EVM address' })
  tokenAddress!: string;

  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress!: string;

  /** A decimal string, denominated in the input token for this side — see
   *  docs/TRADING.md#quote-system. Never parsed as a JS number. */
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'amount must be a positive decimal number' })
  amount!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(TRADING_DEFAULTS.minSlippageBps)
  @Max(TRADING_DEFAULTS.maxSlippageBps)
  slippageBps: number = TRADING_DEFAULTS.defaultSlippageBps;
}
