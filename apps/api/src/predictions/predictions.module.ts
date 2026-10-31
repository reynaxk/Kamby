import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LiveModule } from '../live/live.module';
import { NarrativesModule } from '../narratives/narratives.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SocialModule } from '../social/social.module';
import { PredictionsCronService } from './predictions-cron.service';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';

/** Predictions — free community forecasts (votes only). See PredictionsService. */
@Module({
  imports: [IdentityModule, RealtimeModule, LiveModule, SocialModule, NarrativesModule],
  controllers: [PredictionsController],
  providers: [PredictionsService, PredictionsCronService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
