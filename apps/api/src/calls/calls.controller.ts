import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { CallsService } from './calls.service';

class SdpDto {
  @IsIn(['offer', 'answer'])
  type!: 'offer' | 'answer';

  @IsString()
  @MaxLength(200_000)
  sdp!: string;
}

class StartDto {
  @IsOptional()
  @IsBoolean()
  video?: boolean;
}

class LocalTrackDto {
  @IsString()
  @MaxLength(16)
  mid!: string;

  @IsString()
  @MaxLength(80)
  trackName!: string;

  @IsIn(['audio', 'video', 'screen'])
  kind!: 'audio' | 'video' | 'screen';
}

class PublishDto {
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription!: SdpDto;

  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => LocalTrackDto)
  tracks!: LocalTrackDto[];
}

class RemoteTrackDto {
  @IsString()
  @MaxLength(80)
  sessionId!: string;

  @IsString()
  @MaxLength(80)
  trackName!: string;
}

class PullDto {
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => RemoteTrackDto)
  tracks!: RemoteTrackDto[];
}

class RenegotiateDto {
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription!: SdpDto;
}

class CloseDto {
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  mids!: string[];

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  trackNames!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SdpDto)
  sessionDescription?: SdpDto;
}

class MuteDto {
  @IsBoolean()
  muted!: boolean;
}

/** Calls in a chat (2026-10-17) — see CallsService. `:id` is the conversation. */
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.calls.get(user.id, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @Body() body: StartDto, @CurrentUser() user: SessionUser) {
    return this.calls.start(user.id, id, body.video ?? false);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/join')
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.calls.join(user.id, id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: PublishDto, @CurrentUser() user: SessionUser) {
    return this.calls.publish(user.id, id, body);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/pull')
  pull(@Param('id', ParseUUIDPipe) id: string, @Body() body: PullDto, @CurrentUser() user: SessionUser) {
    return this.calls.pull(user.id, id, body.tracks);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/renegotiate')
  renegotiate(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenegotiateDto, @CurrentUser() user: SessionUser) {
    return this.calls.renegotiate(user.id, id, body.sessionDescription);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Body() body: CloseDto, @CurrentUser() user: SessionUser) {
    return this.calls.close(user.id, id, body);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/mute')
  async mute(@Param('id', ParseUUIDPipe) id: string, @Body() body: MuteDto, @CurrentUser() user: SessionUser) {
    await this.calls.mute(user.id, id, body.muted);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/heartbeat')
  heartbeat(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.calls.heartbeat(user.id, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/leave')
  async leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.calls.leave(user.id, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @Post(':id/decline')
  async decline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.calls.decline(user.id, id);
  }
}
