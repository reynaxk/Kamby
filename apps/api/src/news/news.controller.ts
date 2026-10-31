import { Controller, Get, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { interval, map, merge, type Observable } from 'rxjs';
import { RealtimeService } from '../realtime/realtime.service';
import { NEWS_PAGE_MAX, NewsService } from './news.service';

class NewsQueryDto {
  /** Chain identifier ("eip155:8453", "solana") — with `address`, one coin's news. */
  @IsOptional()
  @IsString()
  @Matches(/^(eip155:\d+|solana)$/)
  chain?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{32,64}$/)
  address?: string;

  @IsOptional()
  @IsISO8601()
  @MaxLength(40)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NEWS_PAGE_MAX)
  limit?: number;
}

/** Crypto news — public. See NewsService and the workers' NewsIngestionService. */
@Controller('news')
export class NewsController {
  constructor(
    private readonly news: NewsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Newest first. `chain` + `address` for one coin, `before` (an item's publishedAt) for older pages. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list(@Query() query: NewsQueryDto) {
    return this.news.list({ chainIdentifier: query.chain, tokenAddress: query.address, before: query.before, limit: query.limit });
  }

  /** New headlines as they land (event `news`, a full NewsItem), plus a heartbeat. */
  @Sse('stream')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  stream(): Observable<MessageEvent> {
    const news$ = this.realtime.newsEvents$.pipe(map((item): MessageEvent => ({ type: 'news', data: item })));
    const heartbeat$ = interval(25_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(news$, heartbeat$);
  }
}
