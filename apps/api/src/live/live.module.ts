import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { IdentityModule } from '../identity/identity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

/** Live rooms (2026-10-17) — see LiveService. */
@Module({
  imports: [IdentityModule, RealtimeModule, CallsModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
