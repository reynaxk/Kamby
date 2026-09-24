import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LEADERBOARD_CHAIN_FILTERS, PnlWindowSchema, type LeaderboardChainFilter, type PnlWindow } from '@kamby/domain';

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

  /** Omitted means the real default: one unified ranking across every chain. */
  @IsOptional()
  @IsIn(LEADERBOARD_CHAIN_FILTERS)
  chain?: LeaderboardChainFilter;
}
