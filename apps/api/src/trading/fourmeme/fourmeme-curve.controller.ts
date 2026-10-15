import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../identity/current-user.decorator';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../../identity/identity.service';
import { FourMemeCurveService } from './fourmeme-curve.service';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Four.meme coins still on their curve — see FourMemeCurveService. */
@Controller('trading/fourmeme')
export class FourMemeCurveController {
  constructor(private readonly curve: FourMemeCurveService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':token/state')
  state(@Param('token') token: string) {
    if (!ADDRESS.test(token)) throw new BadRequestException('Not a coin address');
    return this.curve.state(token);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('trades')
  start(@Body() body: { side?: unknown; walletAddress?: unknown; token?: unknown; amountUsd?: unknown; amountRaw?: unknown }, @CurrentUser() user: SessionUser) {
    const wallet = typeof body.walletAddress === 'string' && ADDRESS.test(body.walletAddress) ? (body.walletAddress as `0x${string}`) : null;
    const token = typeof body.token === 'string' && ADDRESS.test(body.token) ? (body.token as `0x${string}`) : null;
    if (!wallet || !token) throw new BadRequestException('Missing wallet or coin');
    if (body.side === 'BUY' && typeof body.amountUsd === 'number') return this.curve.startBuy(user.id, wallet, token, body.amountUsd);
    if (body.side === 'SELL' && typeof body.amountRaw === 'string' && /^\d{1,40}$/.test(body.amountRaw)) return this.curve.startSell(user.id, wallet, token, BigInt(body.amountRaw));
    throw new BadRequestException('Say what to buy or sell');
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('trades/:id/next')
  next(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: { txHashes?: unknown }, @CurrentUser() user: SessionUser) {
    const hashes = Array.isArray(body.txHashes) ? body.txHashes : [];
    if (hashes.length === 0 || hashes.length > 4 || !hashes.every((h) => typeof h === 'string' && HASH.test(h))) throw new BadRequestException('Send the transaction hashes');
    return this.curve.next(user.id, id, hashes as string[]);
  }
}
