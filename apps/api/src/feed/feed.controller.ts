import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { FeedService } from './feed.service';

class FeedQueryDto {
  @IsOptional()
  @IsIn(['foryou', 'following'])
  tab?: 'foryou' | 'following';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;

  /** A trader's own posts (their profile address). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  address?: string;
}

class AttachDto {
  @IsIn(['trade', 'pnl'])
  kind!: 'trade' | 'pnl';

  @IsString()
  @MaxLength(32)
  chain!: string;

  @IsString()
  @MaxLength(64)
  tokenAddress!: string;
}

class PostDto {
  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttachDto)
  attach?: AttachDto;
}

class LikeDto {
  @IsBoolean()
  on!: boolean;
}

class ReplyDto {
  @IsString()
  @MaxLength(1000)
  body!: string;
}

/** The Feed — reading is public; posting, liking, replying and reporting need a session. */
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get()
  list(@Query() query: FeedQueryDto, @CurrentUser() user: SessionUser | null) {
    if (query.address) return this.feed.byAddress(user?.id ?? null, query.address, query.before);
    return this.feed.list(user?.id ?? null, query.tab ?? 'foryou', query.before);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('posts')
  post(@Body() body: PostDto, @CurrentUser() user: SessionUser) {
    return this.feed.post(user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('posts/:id/like')
  like(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: LikeDto, @CurrentUser() user: SessionUser) {
    return this.feed.like(user.id, id, body.on);
  }

  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get('posts/:id/replies')
  replies(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: SessionUser | null) {
    return this.feed.replies(user?.id ?? null, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('posts/:id/replies')
  reply(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReplyDto, @CurrentUser() user: SessionUser) {
    return this.feed.reply(user.id, id, body.body);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('posts/:id/report')
  report(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: SessionUser) {
    return this.feed.report(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(204)
  @Post('posts/:id/delete')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: SessionUser) {
    await this.feed.remove(user.id, id);
  }
}
