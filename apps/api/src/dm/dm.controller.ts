import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
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

  @IsOptional()
  @IsUUID()
  channelId?: string;
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

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;
}

class CoinDto {
  @IsIn(['solana', 'base', 'bnb', 'robinhood'])
  chain!: string;

  @Matches(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
  tokenAddress!: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;
}

class MuteDto {
  /** Minutes to mute (0 = unmute); leave out with `forever: true` to mute until unmuted. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 365)
  minutes?: number;

  @IsOptional()
  @IsBoolean()
  forever?: boolean;
}

class SquadSettingsDto {
  @IsOptional()
  @IsIn(['private', 'gated', 'public'])
  visibility?: 'private' | 'gated' | 'public';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  about?: string;
}

class PresenceDto {
  @IsOptional()
  @IsUUID()
  viewing?: string;
}

class CommunityDto {
  @IsString()
  @MaxLength(60)
  title!: string;
}

class ChannelDto {
  @IsString()
  @MaxLength(40)
  name!: string;

  @IsIn(['text', 'voice'])
  kind!: 'text' | 'voice';
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

class GroupDto {
  @IsString()
  @MaxLength(60)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  usernames!: string[];
}

class MembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  usernames!: string[];
}

class RenameDto {
  @IsString()
  @MaxLength(60)
  title!: string;
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

  // --- groups (2026-10-17) ---

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('groups')
  createGroup(@Body() body: GroupDto, @CurrentUser() user: SessionUser) {
    return this.dm.createGroup(user.id, body.title, body.usernames);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('conversations/:id/members')
  addMembers(@Param('id', ParseUUIDPipe) id: string, @Body() body: MembersDto, @CurrentUser() user: SessionUser) {
    return this.dm.addMembers(user.id, id, body.usernames);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('conversations/:id/members/:userId/remove')
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() user: SessionUser) {
    return this.dm.removeMember(user.id, id, userId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(204)
  @Post('conversations/:id/leave')
  async leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    await this.dm.leave(user.id, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('conversations/:id/rename')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenameDto, @CurrentUser() user: SessionUser) {
    return this.dm.rename(user.id, id, body.title);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/squad')
  squadSettings(@Param('id', ParseUUIDPipe) id: string, @Body() body: SquadSettingsDto, @CurrentUser() user: SessionUser) {
    return this.dm.squadSettings(user.id, id, body);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/mute')
  mute(@Param('id', ParseUUIDPipe) id: string, @Body() body: MuteDto, @CurrentUser() user: SessionUser) {
    return this.dm.mute(user.id, id, body.forever ? null : (body.minutes ?? 0));
  }

  /** Kamby is open (every ~30 s while visible) — and which chat, if one is on screen. */
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @HttpCode(204)
  @Post('presence')
  async presence(@Body() body: PresenceDto, @CurrentUser() user: SessionUser) {
    await this.dm.presence(user.id, body.viewing);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('communities')
  createCommunity(@Body() body: CommunityDto, @CurrentUser() user: SessionUser) {
    return this.dm.createCommunity(user.id, body.title);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/channels')
  createChannel(@Param('id', ParseUUIDPipe) id: string, @Body() body: ChannelDto, @CurrentUser() user: SessionUser) {
    return this.dm.createChannel(user.id, id, body.name, body.kind);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/channels/:channelId/delete')
  deleteChannel(@Param('id', ParseUUIDPipe) id: string, @Param('channelId', ParseUUIDPipe) channelId: string, @CurrentUser() user: SessionUser) {
    return this.dm.deleteChannel(user.id, id, channelId);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('conversations/:id/invite/reset')
  resetInvite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.dm.resetInvite(user.id, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('invite/:code')
  invitePreview(@Param('code') code: string, @CurrentUser() user: SessionUser) {
    return this.dm.invitePreview(user.id, inviteParam(code));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invite/:code/join')
  joinByInvite(@Param('code') code: string, @CurrentUser() user: SessionUser) {
    return this.dm.joinByInvite(user.id, inviteParam(code));
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('conversations/:id')
  conversation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.dm.conversation(user.id, id);
  }

  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get('conversations/:id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQueryDto, @CurrentUser() user: SessionUser) {
    return this.dm.messages(user.id, id, query.before, query.channelId);
  }

  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  sendText(@Param('id', ParseUUIDPipe) id: string, @Body() body: TextDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendText(user.id, id, body.body, body.channelId, body.replyToId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/coin')
  sendCoin(@Param('id', ParseUUIDPipe) id: string, @Body() body: CoinDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendCoin(user.id, id, body.chain, body.tokenAddress, body.channelId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conversations/:id/pnl')
  sendPnl(@Param('id', ParseUUIDPipe) id: string, @Body() body: CoinDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendPnl(user.id, id, body.chain, body.tokenAddress, body.channelId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conversations/:id/trade')
  sendTrade(@Param('id', ParseUUIDPipe) id: string, @Body() body: CoinDto, @CurrentUser() user: SessionUser) {
    return this.dm.sendTrade(user.id, id, body.chain, body.tokenAddress, body.channelId);
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

/** Invite codes are 8 lowercase letters/digits; anything else is not a code. */
function inviteParam(code: string): string {
  const c = (code ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(c)) throw new NotFoundException('This invite link is not valid.');
  return c;
}
