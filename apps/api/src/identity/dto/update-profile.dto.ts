import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Basic shape-checking only — length bounds wide enough to admit anything
 *  `isValidUsername`/`normalizeUsername` (@kamby/domain) will itself judge for real:
 *  charset, reserved-word list, and case normalization. Same split as WalletVerifyDto's own
 *  comment: the DTO catches garbage input, the service owns the actual business rule. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  username?: string;
}
