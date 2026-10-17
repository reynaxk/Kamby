import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialModule } from '../social/social.module';
import { TransfersModule } from '../transfers/transfers.module';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';

/** Private messages (2026-10-17) — see DmService. */
@Module({
  imports: [IdentityModule, NotificationsModule, SocialModule, TransfersModule, MediaModule],
  controllers: [DmController],
  providers: [DmService],
  exports: [DmService],
})
export class DmModule {}
