import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ChainIdQueryDto } from '../../market/dto/chain-id-query.dto';

/** Same shape/bounds as market's TokenTradersQueryDto — Thesis rides the same chain-aware
 *  query-param convention every other single-token route in this codebase already uses. */
export class ThesesQueryDto extends ChainIdQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
