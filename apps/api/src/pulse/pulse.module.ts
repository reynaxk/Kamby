import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PulseController } from './pulse.controller';
import { PulseService } from './pulse.service';
import { TokenChatService } from './token-chat.service';
import { SocialModule } from '../social/social.module';

/** Pulse, the worldwide chat — see PulseService. */
@Module({
  imports: [IdentityModule, RealtimeModule, SocialModule],
  controllers: [PulseController],
  providers: [PulseService, TokenChatService],
})
export class PulseModule {}
