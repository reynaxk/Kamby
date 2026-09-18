import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
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

  /** Asks the EVM gas relayer to sponsor this trade's gas — see
   *  docs/GAS_RELAYER_PLAN.md's EVM section. Never itself a guarantee: the response only
   *  carries `consentTypedData` when the request is both this flag AND actually eligible
   *  (relayer configured for this chain, wallet allowlisted if a rollout allowlist is
   *  set) — omitted (indistinguishable from `false`) otherwise, same non-distinguishable-
   *  rejection discipline the Solana relayer's own test-wallet gate already established. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sponsorshipRequested: boolean = false;
}
