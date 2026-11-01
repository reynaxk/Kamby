import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsController, UserTitleController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

/** Achievements & titles (2026-11-01). See AchievementsService. */
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [AchievementsController, UserTitleController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
