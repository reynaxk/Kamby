import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LiveService } from './live.service';

class SdpDto {
  @IsIn(['offer', 'answer'])
  type!: 'offer' | 'answer';

  @IsString()
  @MaxLength(200_000)
  sdp!: string;
}

class PinTradeDto {
  @IsOptional()
  @IsIn(['solana', 'base', 'bnb', 'robinhood'])
  chain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tokenAddress?: string;
}

class StartDto {
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  tokenKey?: string;
}

class LocalTrackDto {
  @IsString()
  @MaxLength(16)
  mid!: string;

  @IsString()
  @MaxLength(80)
  trackName!: string;

  @IsIn(['audio', 'screen'])
  kind!: 'audio' | 'screen';
}

class PublishDto {
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription!: SdpDto;

  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => LocalTrackDto)
  tracks!: LocalTrackDto[];
}

class CloseDto {
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  mids!: string[];

  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  trackNames!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription?: SdpDto;
}

class PullDto {
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  trackNames!: string[];
}

class RenegotiateDto {
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription!: SdpDto;
}

class SayDto {
  @IsString()
  @MaxLength(300)
  body!: string;
}

class MuteDto {
  @IsBoolean()
  muted!: boolean;
}

/** Live rooms (2026-10-17) — see LiveService. Browsing and the room's live stream are public;
 *  going live, watching (a Cloudflare session costs us) and chatting need a session. */
@Controller('live')
export class LiveController {
  constructor(
    private readonly live: LiveService,
    private readonly realtime: RealtimeService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list() {
    return this.live.list();
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.get(id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id/chat')
  chat(@Param('id', ParseUUIDPipe) id: string) {
    return this.live.chat(id);
  }

  /** The room as it changes: chat lines, track/viewer changes, the end — plus a heartbeat. */
  @Sse(':id/stream')
  stream(@Param('id', ParseUUIDPipe) id: string): Observable<MessageEvent> {
    const events$ = this.realtime.liveEvents$.pipe(
      filter((e) => e.roomId === id),
      map((e): MessageEvent => ({ type: e.type, data: e })),
    );
    const heartbeat$ = interval(20_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(events$, heartbeat$);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post()
  start(@Body() body: StartDto, @CurrentUser() user: SessionUser) {
    return this.live.start(user.id, body.title, body.tokenKey);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: PublishDto, @CurrentUser() user: SessionUser) {
    return this.live.publishTracks(user.id, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Body() body: CloseDto, @CurrentUser() user: SessionUser) {
    return this.live.closeTracks(user.id, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/host-renegotiate')
  hostRenegotiate(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenegotiateDto, @CurrentUser() user: SessionUser) {
    return this.live.hostRenegotiate(user.id, id, body.sessionDescription);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/mute')
  async mute(@Param('id', ParseUUIDPipe) id: string, @Body() body: MuteDto, @CurrentUser() user: SessionUser) {
    await this.live.mute(user.id, id, body.muted);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/stop')
  async stop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.live.stop(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/watch')
  watch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.live.watch(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/pull')
  pull(@Param('id', ParseUUIDPipe) id: string, @Body() body: PullDto, @CurrentUser() user: SessionUser) {
    return this.live.pull(user.id, id, body.trackNames);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/renegotiate')
  renegotiate(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenegotiateDto, @CurrentUser() user: SessionUser) {
    return this.live.viewerRenegotiate(user.id, id, body.sessionDescription);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/heartbeat')
  heartbeat(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.live.heartbeat(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/leave')
  async leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.live.leave(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/trade')
  pinTrade(@Param('id', ParseUUIDPipe) id: string, @Body() body: PinTradeDto, @CurrentUser() user: SessionUser) {
    return this.live.pinTrade(user.id, id, body.chain && body.tokenAddress ? { chain: body.chain, tokenAddress: body.tokenAddress } : null);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/chat')
  say(@Param('id', ParseUUIDPipe) id: string, @Body() body: SayDto, @CurrentUser() user: SessionUser) {
    return this.live.say(user.id, id, body.body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.live.report(user.id, id);
  }
}
