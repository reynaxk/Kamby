import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { MAX_SHOWCASE_TITLES } from '@kamby/domain';

/** PATCH /achievements/title (and /user/title): null takes the worn title off. */
export class SetTitlesDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  equippedTitleId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SHOWCASE_TITLES)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  showcaseTitleIds?: string[];
}
