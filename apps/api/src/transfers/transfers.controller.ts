import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { TransferNotifyService } from './transfer-notify.service';

/** "Send to a Kamby user" — telling the recipient, once the transfer is checked on-chain. */
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransferNotifyService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('notify')
  notify(@Body() body: { username?: unknown; chain?: unknown; txRef?: unknown }, @CurrentUser() user: SessionUser) {
    const { username, chain, txRef } = body;
    if (typeof username !== 'string' || username.length > 40 || typeof chain !== 'string' || !['base', 'bnb', 'robinhood', 'solana'].includes(chain) || typeof txRef !== 'string' || txRef.length > 100) {
      throw new BadRequestException('Say who, which network and which transaction');
    }
    return this.transfers.notify(user.id, { username, chain, txRef });
  }
}
