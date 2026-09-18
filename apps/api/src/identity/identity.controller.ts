import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AddressParamDto } from '../social/dto/address-param.dto';
import { MAX_FILE_SIZE_BYTES, type UploadableFile } from '../media/r2-storage.service';
import { CurrentUser } from './current-user.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { SolanaAddressParamDto } from './dto/solana-address-param.dto';
import { SolanaWalletChallengeDto } from './dto/solana-wallet-challenge.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';
import { WalletVerifyDto } from './dto/wallet-verify.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IdentityService, type SessionUser } from './identity.service';
import { ProfileService } from './profile.service';
import { SolanaWalletService } from './solana-wallet.service';
import { WalletService } from './wallet.service';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly wallets: WalletService,
    private readonly solanaWallets: SolanaWalletService,
    private readonly profile: ProfileService,
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

  // Identity: username + PFP — see docs/TRADER_INTELLIGENCE.md#realized-pnl and
  // ProfileService's own doc comment for why avatarUrl is never client-settable via this
  // route (only through the upload endpoint below, which sets it server-side).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@CurrentUser() user: SessionUser) {
    return this.profile.getProfile(user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Patch('profile')
  updateProfile(@Body() body: UpdateProfileDto, @CurrentUser() user: SessionUser) {
    if (body.username === undefined) throw new BadRequestException('Nothing to update — provide a username.');
    return this.profile.updateProfile(user.id, body.username);
  }

  // 5/min — real I/O (an upload to R2), not a cheap metadata write; see
  // docs/TRADER_INTELLIGENCE.md's own convention for rate-limiting the one endpoint per
  // phase that does real work rather than a bounded DB query.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  uploadAvatar(@UploadedFile() file: UploadableFile | undefined, @CurrentUser() user: SessionUser) {
    if (!file) throw new BadRequestException('No file uploaded — expected a multipart field named "file".');
    return this.profile.uploadAvatar(user.id, file);
  }
}
