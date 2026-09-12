import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/current-user.decorator';
import { SolanaAddressParamDto } from '../identity/dto/solana-address-param.dto';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { CursorQueryDto } from '../social/dto/cursor-query.dto';
import { SolanaQuoteDto } from './dto/solana-quote.dto';
import { SolanaSubmitTransactionDto } from './dto/solana-submit-transaction.dto';
import { SolanaQuoteService } from './solana-quote.service';
import { SolanaTopupService } from './solana-topup.service';
import { SolanaTransactionService } from './solana-transaction.service';

/**
 * Solana's counterpart to TradingController — see that file's own doc comment for the
 * shared authorization model (every endpoint requires a session; every mutation
 * additionally verifies the wallet in play belongs to that session). Separate route
 * namespace (`/solana/*`, not `/trade/*`) since the request/response shapes genuinely
 * differ — see docs/TRADING.md#solana.
 */
@UseGuards(JwtAuthGuard)
@Controller('solana')
export class SolanaController {
  constructor(
    private readonly quotes: SolanaQuoteService,
    private readonly transactions: SolanaTransactionService,
    private readonly topup: SolanaTopupService,
  ) {}

  // Same tighter-than-default throttle reasoning as TradingController.getQuote — real
  // aggregator calls are expensive and rate-limited upstream.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('quote')
  getQuote(@Body() body: SolanaQuoteDto, @CurrentUser() user: SessionUser) {
    return this.quotes.createQuote({
      userId: user.id,
      walletAddress: body.walletAddress,
      side: body.side,
      tokenMint: body.tokenMint,
      amount: body.amount,
      slippageBps: body.slippageBps,
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('transactions')
  submitTransaction(@Body() body: SolanaSubmitTransactionDto, @CurrentUser() user: SessionUser) {
    return this.transactions.submitTransaction({
      userId: user.id,
      walletAddress: body.walletAddress,
      quoteId: body.quoteId,
      signature: body.signature,
    });
  }

  @Get('transactions/:id')
  getTransaction(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.transactions.getTransaction(user.id, id);
  }

  // Deliberately no ?userId= — see TradingController.getHistory's identical reasoning.
  @Get('history')
  getHistory(@Query() query: CursorQueryDto, @CurrentUser() user: SessionUser) {
    return this.transactions.getHistory(user.id, query.cursor, query.limit);
  }

  /**
   * Triggers the one-time new-wallet SOL top-up (see SolanaTopupService's own doc
   * comment) — called by the client right after a wallet is newly verified
   * (`POST /identity/solana-wallet/verify`). Idempotent (a live balance check, not a
   * client-controllable flag), so calling it more than once for the same wallet is safe
   * and simply a no-op past the first successful top-up. Rate-limited at the standard
   * mutation tier, same as everything else here — no per-wallet-ever tracking beyond that,
   * see SolanaTopupService's own doc comment on why that tradeoff is acceptable for a
   * fixed, tiny amount.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('wallet/:address/topup')
  ensureWalletFunded(@Param() params: SolanaAddressParamDto) {
    return this.topup.ensureFunded(params.address);
  }
}
