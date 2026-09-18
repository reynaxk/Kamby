import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_CHAIN_IDS } from '@kamby/domain';

/**
 * Shared across every `market.controller.ts` route that reads/mutates a single token's
 * state (getToken/history/traders/watch/unwatch) — mirrors
 * `trading/dto/quote-query.dto.ts`'s identical `chainId` field exactly, added 2026-09-16
 * as part of making these routes chain-aware (the underlying `MarketService`/
 * `WatchlistService` methods already accepted and correctly used a real chainId; only this
 * controller layer was still hardcoding `DEFAULT_CHAIN_ID`, per market.controller.ts's own
 * prior doc comment). Omitted means "whichever chain this deployment defaults to" — see
 * MarketController, which substitutes `DEFAULT_CHAIN_ID`. Rejected outright (not silently
 * ignored) when present but not one of this deployment's configured chains — never guessed
 * at deeper in the stack.
 */
export class ChainIdQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn(SUPPORTED_CHAIN_IDS)
  chainId?: number;
}
