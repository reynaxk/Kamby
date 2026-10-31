import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module';
import { MarketFeedsModule } from '../market-feeds/market-feeds.module';
import { SocialModule } from '../social/social.module';
import { NarrativesController } from './narratives.controller';
import { NarrativesService } from './narratives.service';

/** Narratives and their Heat Index — see NarrativesService. */
@Module({
  imports: [MarketFeedsModule, LiveModule, SocialModule],
  controllers: [NarrativesController],
  providers: [NarrativesService],
})
export class NarrativesModule {}
