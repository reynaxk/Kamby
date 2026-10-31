import { Controller, ForbiddenException, Get, HttpCode, Optional, Param, Post, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { IsEthereumAddress, IsIn } from 'class-validator';
import { Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DEFAULT_CHAIN_ID, EVM_USDC_BY_CHAIN_ID, normalizeEvmAddress } from '@kamby/domain';
import { EvmGasTopupService } from './evm-gas-topup.service';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { CursorQueryDto } from '../social/dto/cursor-query.dto';
import { QuoteQueryDto } from './dto/quote-query.dto';
import { RelaySwapDto } from './dto/relay-swap.dto';
import { SubmitFeeTransactionDto } from './dto/submit-fee-transaction.dto';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';
import { QuoteService } from './quote.service';
import { EvmGasRelayerQuoteService } from './relayer/evm-gas-relayer-quote.service';
import { TransactionService } from './transaction.service';
import { TradingPausedGuard } from './trading-paused.guard';

class EnsureGasDto {
  @IsIn([8453, 56, 4663])
  chainId!: number;

  @IsEthereumAddress()
  walletAddress!: string;
}

/**
 * Every endpoint here requires a session, and every mutation additionally verifies the
 * wallet in play belongs to that session (see docs/TRADING.md#authorization) —
 * unlike apps/api/src/social, nothing in trading is meant to be publicly browsable, since
 * it's all inherently tied to one person's funds and history.
 *
 * 2026-10-31: EnsureGasDto had been inserted between this guard and the class (10-21), so the
 * guard decorated the DTO and every /trade route ran without a session — `user.id` threw and
 * quote, relay, transactions, fee, gas and history all answered 500. Keep DTOs above this comment.
 */
@UseGuards(JwtAuthGuard)
@Controller('trade')
export class TradingController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly transactions: TransactionService,
    private readonly gasRelayer: EvmGasRelayerQuoteService,
    @Optional() private readonly gasTopup?: EvmGasTopupService,
  ) {}

  /** A few cents of ETH/BNB from Kamby's gas tank before the wallet sends a coin (2026-10-21,
   *  Send a coin you hold) — the same top-up a trade gets, for the caller's own verified wallet. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('gas')
  async ensureGas(@Body() body: EnsureGasDto, @CurrentUser() user: SessionUser): Promise<void> {
    const walletAddress = normalizeEvmAddress(body.walletAddress);
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== user.id || wallet.verifiedAt === null) throw new ForbiddenException('This wallet is not verified as belonging to your account');
    const usdc = EVM_USDC_BY_CHAIN_ID[body.chainId];
    if (!this.gasTopup || !usdc) return;
    const result = await this.gasTopup.ensureGas(body.chainId, walletAddress, usdc);
    if (result === 'stranded') throw new UnprocessableEntityException('Sending on this network is getting ready — try again in a few minutes.');
  }

  // Real aggregator calls are expensive and rate-limited upstream — tighter than the
  // app-wide default so one client can't hammer it, loose enough not to break normal
  // rapid re-quoting as a user adjusts an amount.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('quote')
  @UseGuards(TradingPausedGuard)
  async getQuote(@Query() query: QuoteQueryDto, @CurrentUser() user: SessionUser) {
    const chainId = query.chainId ?? DEFAULT_CHAIN_ID;
    const quote = await this.quotes.createQuote({
      userId: user.id,
      walletAddress: query.walletAddress,
      tokenAddress: query.tokenAddress,
      chainId,
      side: query.side,
      amount: query.amount,
      slippageBps: query.slippageBps,
    });
    return this.gasRelayer.attachSponsorshipIfEligible(quote, {
      chainId,
      walletAddress: query.walletAddress,
      sponsorshipRequested: query.sponsorshipRequested,
    });
  }

  // See docs/GAS_RELAYER_PLAN.md's EVM section. Same throttle reasoning as the other
  // mutating routes here — this one additionally spends the relayer's own gas per call, so
  // it's never looser than submitTransaction's own limit.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('relay')
  relaySwap(@Body() body: RelaySwapDto, @CurrentUser() user: SessionUser) {
    return this.gasRelayer.relay({
      userId: user.id,
      walletAddress: body.walletAddress,
      quoteId: body.quoteId,
      signature: body.signature,
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
