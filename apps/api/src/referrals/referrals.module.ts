import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** Phase 7 — see docs/REFERRALS.md. Imports IdentityModule for JwtAuthGuard, same pattern
 *  TradingModule and others use for "who is calling." */
@Module({
  imports: [IdentityModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
})
export class ReferralsModule {}
