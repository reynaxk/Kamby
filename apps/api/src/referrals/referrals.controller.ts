import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { ReferralsService } from './referrals.service';

/** Every endpoint here requires a session — a referral summary is inherently
 *  "your own," same authorization posture as apps/api/src/trading. */
@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me')
  getMySummary(@CurrentUser() user: SessionUser) {
    return this.referrals.getMySummary(user.id);
  }
}
