import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PulseController } from './pulse.controller';
import { PulseService } from './pulse.service';

/** Pulse, the worldwide chat — see PulseService. */
@Module({
  imports: [IdentityModule, RealtimeModule],
  controllers: [PulseController],
  providers: [PulseService],
})
export class PulseModule {}
