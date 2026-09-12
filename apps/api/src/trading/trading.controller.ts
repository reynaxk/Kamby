import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DEFAULT_CHAIN_ID } from '@kamby/domain';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { CursorQueryDto } from '../social/dto/cursor-query.dto';
import { QuoteQueryDto } from './dto/quote-query.dto';
import { SubmitFeeTransactionDto } from './dto/submit-fee-transaction.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { QuoteService } from './quote.service';
import { TransactionService } from './transaction.service';

/**
 * Every endpoint here requires a session, and every mutation additionally verifies the
 * wallet in play belongs to that session (see docs/TRADING.md#authorization) —
 * unlike apps/api/src/social, nothing in trading is meant to be publicly browsable, since
 * it's all inherently tied to one person's funds and history.
 */
@UseGuards(JwtAuthGuard)
@Controller('trade')
export class TradingController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly transactions: TransactionService,
  ) {}

  // Real aggregator calls are expensive and rate-limited upstream — tighter than the
  // app-wide default so one client can't hammer it, loose enough not to break normal
  // rapid re-quoting as a user adjusts an amount.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('quote')
  getQuote(@Query() query: QuoteQueryDto, @CurrentUser() user: SessionUser) {
    return this.quotes.createQuote({
      userId: user.id,
      walletAddress: query.walletAddress,
      tokenAddress: query.tokenAddress,
      chainId: query.chainId ?? DEFAULT_CHAIN_ID,
      side: query.side,
      amount: query.amount,
      slippageBps: query.slippageBps,
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('transactions')
  submitTransaction(@Body() body: SubmitTransactionDto, @CurrentUser() user: SessionUser) {
    return this.transactions.submitTransaction({
      userId: user.id,
      walletAddress: body.walletAddress,
      quoteId: body.quoteId,
      txHash: body.txHash,
    });
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.transactions.getTransaction(user.id, id);
  }

  // See docs/TRADING.md#guaranteed-usdc-fees — the second, separate USDC transfer a
  // guaranteed-USDC-fee trade's wallet signs after its swap. Same throttle reasoning as
  // submitTransaction above.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('transactions/:id/fee')
  submitFeeTransaction(@Param('id') id: string, @Body() body: SubmitFeeTransactionDto, @CurrentUser() user: SessionUser) {
    return this.transactions.submitFeeTransaction({
      userId: user.id,
      transactionId: id,
      txHash: body.txHash,
    });
  }

  // Deliberately no ?userId= — see docs/TRADING.md#authorization. The authenticated
  // session is the only source of whose history this can ever be.
  @Get('history')
  getHistory(@Query() query: CursorQueryDto, @CurrentUser() user: SessionUser) {
    return this.transactions.getHistory(user.id, query.cursor, query.limit);
  }
}
