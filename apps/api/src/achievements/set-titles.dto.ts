import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CLIENT_ACHIEVEMENT_EVENTS, MAX_SHOWCASE_TITLES, type ClientAchievementEvent } from '@kamby/domain';

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

/** POST /achievements/event — what the app reports (screen time, chart time, clicks, eggs). */
export class AchievementEventDto {
  @IsIn(CLIENT_ACHIEVEMENT_EVENTS)
  kind!: ClientAchievementEvent;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  token?: string;
}
