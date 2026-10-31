import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { PREDICTION_CATEGORIES, PREDICTION_LIMITS, type PredictionCategory, type PredictionFilter } from '@kamby/domain';
import { interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PredictionsService } from './predictions.service';

const FILTERS: PredictionFilter[] = ['all', 'ending', 'popular', 'streamers', 'mine'];

class ListQueryDto {
  @IsOptional()
  @IsIn(FILTERS)
  filter?: PredictionFilter;

  @IsOptional()
  @IsIn(PREDICTION_CATEGORIES)
  category?: PredictionCategory;

  @IsOptional()
  @IsISO8601()
  @MaxLength(40)
  before?: string;
}

class VoteDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(PREDICTION_LIMITS.maxOptions - 1)
  option!: number;
}

class CreateDto {
  @IsString()
  @MaxLength(PREDICTION_LIMITS.titleMax)
  title!: string;

  @IsArray()
  @ArrayMinSize(PREDICTION_LIMITS.minOptions)
  @ArrayMaxSize(PREDICTION_LIMITS.maxOptions)
  @IsString({ each: true })
  @MaxLength(PREDICTION_LIMITS.optionMax, { each: true })
  options!: string[];

  @Type(() => Number)
  @IsIn(PREDICTION_LIMITS.durations as unknown as number[])
  minutes!: number;

  @IsOptional()
  @IsIn(PREDICTION_CATEGORIES)
  category?: PredictionCategory;
}

/** Predictions — free community forecasts. Reading is public; voting and asking need a session. */
@Controller('predictions')
export class PredictionsController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly realtime: RealtimeService,
  ) {}

  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get()
  list(@Query() query: ListQueryDto, @CurrentUser() user: SessionUser | null) {
    return this.predictions.list(user?.id ?? null, query.filter ?? 'all', query.category, query.before);
  }

  /** One vote per person per poll. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/vote')
  vote(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: VoteDto, @CurrentUser() user: SessionUser) {
    return this.predictions.vote(user.id, id, body.option);
  }

  /** A streamer on air or a top trader asks their own question. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() body: CreateDto, @CurrentUser() user: SessionUser) {
    return this.predictions.create(user.id, body);
  }

  /** Vote counts and outcomes as they change (`update`), new polls (`created`), heartbeat. */
  @Sse('stream')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  stream(): Observable<MessageEvent> {
    const events$ = this.realtime.predictionEvents$.pipe(map((event): MessageEvent => ({ type: event.type, data: event.type === 'update' ? event.update : event.prediction })));
    const heartbeat$ = interval(25_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(events$, heartbeat$);
  }
}
