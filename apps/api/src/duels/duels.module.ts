import { Module } from '@nestjs/common';
import { DmModule } from '../dm/dm.module';
import { IdentityModule } from '../identity/identity.module';
import { MarketFeedsModule } from '../market-feeds/market-feeds.module';
import { DuelsController } from './duels.controller';
import { DuelsService } from './duels.service';

/** ⚔️ Duels (2026-10-17) — see DuelsService. */
@Module({
  imports: [IdentityModule, DmModule, MarketFeedsModule],
  controllers: [DuelsController],
  providers: [DuelsService],
})
export class DuelsModule {}
