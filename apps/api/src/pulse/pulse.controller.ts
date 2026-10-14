import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Sse, UseGuards } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PulseService } from './pulse.service';
import { TokenChatService } from './token-chat.service';

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

class TokenQueryDto {
  @IsString()
  @MaxLength(140)
  token!: string;
}

class PostTokenMessageDto {
  @IsString()
  @MaxLength(140)
  token!: string;

  @IsString()
  @MaxLength(1000)
  body!: string;
}

class TokenReactionDto {
  @IsString()
  @MaxLength(140)
  token!: string;

  @IsString()
  @MaxLength(16)
  emoji!: string;
}

/** Pulse — the worldwide chat. Reading and the live stream are public; posting needs a session. */
@Controller('pulse')
export class PulseController {
  constructor(
    private readonly pulse: PulseService,
    private readonly tokenChat: TokenChatService,
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

  // --- One coin's live chat (2026-10-14) ---------------------------------------------------

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('token/messages')
  tokenMessages(@Query() query: TokenQueryDto) {
    return this.tokenChat.list(query.token);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('token/messages')
  postTokenMessage(@Body() body: PostTokenMessageDto, @CurrentUser() user: SessionUser) {
    return this.tokenChat.post(user.id, body.token, body.body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('token/pnl')
  postTokenPnl(@Body() body: TokenQueryDto, @CurrentUser() user: SessionUser) {
    return this.tokenChat.postPnl(user.id, body.token);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(204)
  @Post('token/react')
  async react(@Body() body: TokenReactionDto, @CurrentUser() user: SessionUser) {
    await this.tokenChat.react(user.id, body.token, body.emoji);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('messages/:id/report')
  report(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: SessionUser) {
    return this.tokenChat.report(user.id, id);
  }

  /** One coin's chat live: new messages and trades, reactions, take-downs, plus a heartbeat. */
  @Sse('token/stream')
  tokenStream(@Query() query: TokenQueryDto): Observable<MessageEvent> {
    const events$ = this.realtime.tokenChatEvents$.pipe(
      filter((event) => (event.type === 'item' ? event.item.tokenKey : event.tokenKey) === query.token),
      map((event): MessageEvent => ({ type: event.type, data: event })),
    );
    const heartbeat$ = interval(20_000).pipe(map((): MessageEvent => ({ type: 'heartbeat', data: { atIso: new Date().toISOString() } })));
    return merge(events$, heartbeat$);
  }
}
