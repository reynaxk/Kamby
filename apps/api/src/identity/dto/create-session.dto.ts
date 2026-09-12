import { IsOptional, IsString, Matches } from 'class-validator';

/** `referredByCode` is optional and, if present, only ever the code from a `?ref=` link —
 *  see docs/REFERRALS.md#attribution. Same unambiguous alphabet as generateReferralCode in
 *  identity.service.ts (digits 2-9, letters A-Z excluding I/L/O). Validated here as a shape
 *  check only — resolving it to a real user (or discovering it doesn't match one) happens
 *  in the service, never here. */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[23456789A-HJKMNP-Z]{8}$/i, { message: 'referredByCode must be a well-formed referral code' })
  referredByCode?: string;
}
