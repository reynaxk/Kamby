import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { DmModule } from '../dm/dm.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SolanaModule } from '../solana/solana.module';
import { TradingModule } from '../trading/trading.module';
import { LiveTipsService } from './live-tips.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

/** Live rooms (2026-10-17) — see LiveService. */
@Module({
  imports: [IdentityModule, RealtimeModule, CallsModule, NotificationsModule, DmModule, SolanaModule, TradingModule],
  controllers: [LiveController],
  providers: [LiveService, LiveTipsService],
})
export class LiveModule {}
