import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TrenchesCategory } from '../trenches-category.enum';

export class TrenchesQueryDto {
  @IsEnum(TrenchesCategory)
  category!: TrenchesCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
