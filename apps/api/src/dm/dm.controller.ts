import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { DmService } from './dm.service';

class ListQueryDto {
  @IsOptional()
  @IsIn(['chats', 'requests'])
  box?: 'chats' | 'requests';
}

class PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;
}

class OpenDto {
  @IsString()
  @MaxLength(32)
  username!: string;
}

class TextDto {
  @IsString()
  @MaxLength(1200)
  body!: string;
}

class CoinDto {
  @IsIn(['solana', 'base', 'bnb', 'robinhood'])
  chain!: string;

  @Matches(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
  tokenAddress!: string;
}

class UsdcDto {
  @IsIn(['solana', 'base', 'bnb', 'robinhood'])
  chain!: string;

  @IsString()
  @MaxLength(100)
  txRef!: string;
}

class ReactDto {
  @IsString()
  @MaxLength(16)
  emoji!: string;
}

class BlockDto {
  @IsBoolean()
  blocked!: boolean;
}

class ReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * Private messages (2026-10-17). Everything needs a session; live updates arrive on the private
 * notifications stream (`GET /notifications/stream`, event `dm`).
 */
@UseGuards(JwtAuthGuard)
@Controller('dm')
export class DmController {
  constructor(private readonly dm: DmService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('conversations')
  list(@Query() query: ListQueryDto, @CurrentUser() user: SessionUser) {
    return this.dm.list(user.id, query.box ?? 'chats');
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('unread')
  unread(@CurrentUser() user: SessionUser) {
    return this.dm.unread(user.id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('open')
  open(@Body() body: OpenDto, @CurrentUser() user: SessionUser) {
    return this.dm.open(user.id, body.username);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('conversations/:id')
  conversation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.dm.conversation(user.id, id);
  }

  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get('conversations/:id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQueryDto, @CurrentUser() user: SessionUser) {
    return this.dm.messages(user.id, id, query.before);
  }

  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  sendText(@Param('id', ParseUUIDPipe) id: string, @Body() body: TextDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendText(user.id, id, body.body);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/coin')
  sendCoin(@Param('id', ParseUUIDPipe) id: string, @Body() body: CoinDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendCoin(user.id, id, body.chain, body.tokenAddress);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conversations/:id/pnl')
  sendPnl(@Param('id', ParseUUIDPipe) id: string, @Body() body: CoinDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendPnl(user.id, id, body.chain, body.tokenAddress);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conversations/:id/usdc')
  sendUsdc(@Param('id', ParseUUIDPipe) id: string, @Body() body: UsdcDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendUsdc(user.id, id, body.chain, body.txRef);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(204)
  @Post('conversations/:id/read')
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.dm.read(user.id, id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(204)
  @Post('conversations/:id/typing')
  async typing(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.dm.typing(user.id, id);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('messages/:id/react')
  react(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReactDto, @CurrentUser() user: SessionUser) {
    return this.dm.react(user.id, id, body.emoji);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('conversations/:id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.dm.accept(user.id, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(204)
  @Post('conversations/:id/hide')
  async hide(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.dm.hide(user.id, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('conversations/:id/block')
  block(@Param('id', ParseUUIDPipe) id: string, @Body() body: BlockDto, @CurrentUser() user: SessionUser) {
    return this.dm.block(user.id, id, body.blocked);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('conversations/:id/report')
  async report(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReportDto, @CurrentUser() user: SessionUser) {
    await this.dm.report(user.id, id, body.reason);
  }
}
