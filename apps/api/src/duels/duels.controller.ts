import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DUEL_LIMITS } from '@kamby/domain';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { DuelsService } from './duels.service';

class ChallengeDto {
  @IsString()
  @MaxLength(32)
  opponentUsername!: string;

  @IsInt()
  @IsIn(DUEL_LIMITS.minutes as unknown as number[])
  minutes!: number;

  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

class CheerDto {
  @IsIn(['challenger', 'opponent'])
  side!: 'challenger' | 'opponent';

  @IsString()
  @MaxLength(16)
  emoji!: string;
}

/** ⚔️ Duels (2026-10-17) — see DuelsService. Anyone can watch; acting needs a session. */
@Controller('duels')
export class DuelsController {
  constructor(private readonly duels: DuelsService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  challenge(@Body() body: ChallengeDto, @CurrentUser() user: SessionUser) {
    return this.duels.challenge(user.id, body);
  }

  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser | null) {
    return this.duels.get(user?.id ?? null, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.duels.accept(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/decline')
  decline(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.duels.decline(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.duels.cancel(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/cheer')
  cheer(@Param('id', ParseUUIDPipe) id: string, @Body() body: CheerDto, @CurrentUser() user: SessionUser) {
    return this.duels.react(user.id, id, body.side, body.emoji);
  }
}
