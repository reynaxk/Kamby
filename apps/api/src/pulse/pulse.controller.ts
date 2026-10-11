import { Body, Controller, Get, Post, Query, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PulseService } from './pulse.service';

class PulseListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;
}

class PostPulseDto {
  @IsString()
  @MaxLength(1000)
  body!: string;
}

/** Pulse — the worldwide chat. Reading and the live stream are public; posting needs a session. */
@Controller('pulse')
export class PulseController {
  constructor(
    private readonly pulse: PulseService,
    private readonly realtime: RealtimeService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('messages')
  list(@Query() query: PulseListQueryDto) {
    return this.pulse.list(query.before);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('messages')
  post(@Body() body: PostPulseDto, @CurrentUser() user: SessionUser) {
    return this.pulse.post(user.id, body.body);
  }

  /** New messages as they're posted, plus a heartbeat so the app can tell "quiet" from "offline". */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const messages$ = this.realtime.pulseEvents$.pipe(map((message): MessageEvent => ({ type: 'message', data: message })));
    const heartbeat$ = interval(20_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(messages$, heartbeat$);
  }
}
