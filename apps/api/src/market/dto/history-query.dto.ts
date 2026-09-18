import { IsIn, IsOptional } from 'class-validator';
import { TIMEFRAMES, type Timeframe } from '@kamby/domain';
import { ChainIdQueryDto } from './chain-id-query.dto';

export class HistoryQueryDto extends ChainIdQueryDto {
  @IsOptional()
  @IsIn(TIMEFRAMES)
  timeframe: Timeframe = '1D';
}
