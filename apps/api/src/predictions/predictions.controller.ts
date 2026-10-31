import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min, Max } from 'class-validator';
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

  /** With `address`: only polls about this coin. */
  @IsOptional()
  @Matches(/^(eip155:\d+|solana)$/)
  chain?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9]{32,64}$/)
  address?: string;
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
    const coin = query.chain && query.address ? { chainIdentifier: query.chain, tokenAddress: query.address } : undefined;
    return this.predictions.list(user?.id ?? null, query.filter ?? 'all', query.category, query.before, coin);
  }

  /** A trader's profile tab: what they asked, what they voted, their hit rate. */
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('by/:address')
  byAddress(@Param('address') address: string, @CurrentUser() user: SessionUser | null) {
    if (!/^[A-Za-z0-9]{32,64}$/.test(address)) return { created: [], voted: [], stats: { votes: 0, resolved: 0, correct: 0, accuracyPct: null } };
    return this.predictions.forProfile(user?.id ?? null, address);
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
