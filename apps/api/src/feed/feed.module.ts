import { Module } from '@nestjs/common';
import { DmModule } from '../dm/dm.module';
import { IdentityModule } from '../identity/identity.module';
import { MediaModule } from '../media/media.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

/** The Feed — traders' posts (see FeedService). */
@Module({
  imports: [IdentityModule, DmModule, MediaModule],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
