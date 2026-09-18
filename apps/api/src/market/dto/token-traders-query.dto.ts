import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ChainIdQueryDto } from './chain-id-query.dto';

/** Replaces getTokenTraders' previous ad-hoc `Number.parseInt`/manual clamping with the
 *  same validated-DTO pattern every other query param in this codebase uses (e.g.
 *  QuoteQueryDto's slippageBps). Bounds unchanged: 1-25, default 10. */
export class TokenTradersQueryDto extends ChainIdQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit: number = 10;
}
