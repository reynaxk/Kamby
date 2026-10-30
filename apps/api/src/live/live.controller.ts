import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Res, Sse, StreamableFile, UploadedFile, UseGuards, UseInterceptors, type MessageEvent } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LIVE_LIMITS, type LiveTipChain } from '@kamby/domain';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LiveTipsService } from './live-tips.service';
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

  @IsIn(['audio', 'screen', 'camera'])
  kind!: 'audio' | 'screen' | 'camera';
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

class SilenceDto {
  @IsUUID()
  userId!: string;
}

class TipDto {
  @IsIn(['solana', 'base', 'bnb', 'robinhood'])
  chain!: LiveTipChain;

  @IsNumber()
  @Min(LIVE_LIMITS.tipMinUsd)
  @Max(LIVE_LIMITS.tipMaxUsd)
  amountUsd!: number;
}

class TipProofDto {
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  signedTransactionBase64?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @Matches(/^0x[0-9a-fA-F]{64}$/, { each: true })
  txHashes?: string[];
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
    private readonly tips: LiveTipsService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list() {
    return this.live.list();
  }

  /** The Live page's card picture for a stream (moderated; see LiveService#setThumb). */
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Get(':id/thumb')
  async thumb(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const jpeg = await this.live.thumb(id);
    if (!jpeg) throw new NotFoundException('No picture yet.');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(jpeg, { type: 'image/jpeg' });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':id/thumb')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 200_000 } }))
  setThumb(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @CurrentUser() user: SessionUser) {
    return this.live.setThumb(user.id, id, file);
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

  /** Host: take a chat line down. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/chat/:lineId/remove')
  removeLine(@Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @CurrentUser() user: SessionUser) {
    return this.live.removeLine(user.id, id, lineId);
  }

  /** Host: silence someone in the chat for a while. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/silence')
  silence(@Param('id', ParseUUIDPipe) id: string, @Body() body: SilenceDto, @CurrentUser() user: SessionUser) {
    return this.live.silence(user.id, id, body.userId);
  }

  /** A tip to the host, ready to sign (see LiveTipsService). */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/tips')
  prepareTip(@Param('id', ParseUUIDPipe) id: string, @Body() body: TipDto, @CurrentUser() user: SessionUser) {
    return this.tips.prepare(user.id, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/tips/:tipId')
  submitTip(@Param('id', ParseUUIDPipe) id: string, @Param('tipId', ParseUUIDPipe) tipId: string, @Body() body: TipProofDto, @CurrentUser() user: SessionUser) {
    return this.tips.submit(user.id, id, { tipId, ...body });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.live.report(user.id, id);
  }
}
