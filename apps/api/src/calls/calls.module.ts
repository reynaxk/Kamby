import { Module } from '@nestjs/common';
import { DmModule } from '../dm/dm.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CloudflareRealtimeClient } from './cloudflare-realtime.client';

/** Voice / video / screen-share calls in chats (2026-10-17) — see CallsService. */
@Module({
  imports: [IdentityModule, DmModule, NotificationsModule],
  controllers: [CallsController],
  providers: [CallsService, CloudflareRealtimeClient],
  exports: [CloudflareRealtimeClient],
})
export class CallsModule {}
