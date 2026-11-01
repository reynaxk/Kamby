import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { AchievementsService, TitleLockedError } from './achievements.service';
import { SetTitlesDto } from './set-titles.dto';

const USERNAME = /^[a-z0-9_]{1,20}$/i;

@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.achievements.forMe(user.id);
  }

  /** Badges next to names: `?u=alice,bob` → { alice: 'whale', bob: null }. */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('titles')
  titles(@Query('u') u?: string) {
    const names = (u ?? '').split(',').map((x) => x.trim()).filter((x) => USERNAME.test(x)).slice(0, 60);
    return names.length ? this.achievements.titles(names) : {};
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('u/:username')
  async user(@Param('username') username: string) {
    if (!USERNAME.test(username)) throw new NotFoundException();
    const dto = await this.achievements.forUsername(username);
    if (!dto) throw new NotFoundException();
    return dto;
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch('title')
  setTitle(@CurrentUser() user: SessionUser, @Body() body: SetTitlesDto) {
    return setTitles(this.achievements, user.id, body);
  }
}

/** The spec's path for the same thing: PATCH /v1/user/title. */
@Controller('user')
export class UserTitleController {
  constructor(private readonly achievements: AchievementsService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch('title')
  setTitle(@CurrentUser() user: SessionUser, @Body() body: SetTitlesDto) {
    return setTitles(this.achievements, user.id, body);
  }
}

async function setTitles(service: AchievementsService, userId: string, body: SetTitlesDto) {
  try {
    return await service.setTitles(userId, body);
  } catch (error) {
    if (error instanceof TitleLockedError) throw new BadRequestException(error.message);
    throw error;
  }
}
