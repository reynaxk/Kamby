import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

/** Crypto news from public RSS feeds — see NewsService. */
@Module({
  imports: [RealtimeModule],
  controllers: [NewsController],
  providers: [NewsService],
})
export class NewsModule {}
