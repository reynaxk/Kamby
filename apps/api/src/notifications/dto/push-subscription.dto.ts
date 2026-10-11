import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

/** The 14 app languages — anything else gets English push text. */
const LOCALES = ['en', 'zh', 'ko', 'ja', 'tr', 'ru', 'es', 'pt', 'vi', 'id', 'th', 'de', 'fr', 'bg'];

class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(100)
  auth!: string;
}

/** What `PushSubscription.toJSON()` gives in the browser, plus the app language. */
export class SavePushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: string;
}

export class PushEndpointDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;
}
