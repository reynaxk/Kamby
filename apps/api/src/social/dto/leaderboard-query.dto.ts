import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PnlWindowSchema, type PnlWindow } from '@kamby/domain';

const PNL_WINDOWS = PnlWindowSchema.options;

export class LeaderboardQueryDto {
  @IsOptional()
  @IsIn(PNL_WINDOWS)
  window: PnlWindow = '24h';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 25;
}
