import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AddressParamDto } from '../social/dto/address-param.dto';
import { CurrentUser } from './current-user.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { SolanaAddressParamDto } from './dto/solana-address-param.dto';
import { SolanaWalletChallengeDto } from './dto/solana-wallet-challenge.dto';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';
import { WalletVerifyDto } from './dto/wallet-verify.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IdentityService, type SessionUser } from './identity.service';
import { SolanaWalletService } from './solana-wallet.service';
import { WalletService } from './wallet.service';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly wallets: WalletService,
    private readonly solanaWallets: SolanaWalletService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  @Post('session')
  createSession(@Body() body: CreateSessionDto) {
    return this.identity.createAnonymousSession(body.referredByCode);
  }

  // Challenge issuance is the one wallet-ownership endpoint worth throttling tighter than
  // the mutation default below — see docs/TRADING.md#security (a rate-limited nonce mint
  // is cheap insurance against someone spamming challenges for an address they don't own).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  @Post('wallet/challenge')
  createWalletChallenge(@Body() body: WalletChallengeDto, @CurrentUser() user: SessionUser) {
    return this.wallets.createChallenge(user.id, body.address);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('wallet/verify')
  verifyWalletChallenge(@Body() body: WalletVerifyDto, @CurrentUser() user: SessionUser) {
    return this.wallets.verifyChallenge(user.id, body.nonce, body.signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('wallets')
  listWallets(@CurrentUser() user: SessionUser) {
    return this.wallets.listWallets(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('wallets/:address')
  unlinkWallet(@Param() params: AddressParamDto, @CurrentUser() user: SessionUser) {
    return this.wallets.unlinkWallet(user.id, params.address);
  }

  // Solana counterparts of the four routes above — see SolanaWalletService's own doc
  // comment for why this is a separate service/route set rather than a shared abstraction.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  @Post('solana-wallet/challenge')
  createSolanaWalletChallenge(@Body() body: SolanaWalletChallengeDto, @CurrentUser() user: SessionUser) {
    return this.solanaWallets.createChallenge(user.id, body.address);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('solana-wallet/verify')
  verifySolanaWalletChallenge(@Body() body: WalletVerifyDto, @CurrentUser() user: SessionUser) {
    return this.solanaWallets.verifyChallenge(user.id, body.nonce, body.signature);
  }

  @UseGuards(JwtAuthGuard)
  @Get('solana-wallets')
  listSolanaWallets(@CurrentUser() user: SessionUser) {
    return this.solanaWallets.listWallets(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('solana-wallets/:address')
  unlinkSolanaWallet(@Param() params: SolanaAddressParamDto, @CurrentUser() user: SessionUser) {
    return this.solanaWallets.unlinkWallet(user.id, params.address);
  }
}
