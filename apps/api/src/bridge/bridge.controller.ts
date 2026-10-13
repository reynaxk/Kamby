import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { TradingPausedGuard } from '../trading/trading-paused.guard';
import { BridgeService } from './bridge.service';
import { BridgeQuoteDto } from './dto/bridge-quote.dto';

/** Moving a user's own USDC between their Kamby wallets — see BridgeService. */
@UseGuards(JwtAuthGuard)
@Controller('bridge')
export class BridgeController {
  constructor(private readonly bridge: BridgeService) {}

  @Post('quote')
  @UseGuards(TradingPausedGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  quote(@CurrentUser() user: SessionUser, @Body() body: BridgeQuoteDto) {
    return this.bridge.quote(user.id, body);
  }

  @Get('status/:requestId')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  status(@Param('requestId') requestId: string) {
    return this.bridge.status(requestId);
  }
}
