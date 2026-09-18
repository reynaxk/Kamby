import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifySolanaSignature } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import {
  buildSolanaSignInMessage,
  isSolanaAddress,
  WALLET_CHALLENGE_TTL_MINUTES,
  type LinkedWallet,
  type WalletChallenge,
} from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';

/**
 * Solana's counterpart to WalletService — see that file's own doc comment for the shared
 * "a client-supplied address is never trusted on its own" principle. Kept as a separate,
 * concrete class rather than a shared abstraction over both chain families: Ed25519
 * (here) and ECDSA/secp256k1 (WalletService) verify completely differently, matching this
 * codebase's existing preference for concrete separate classes over one forced-shared
 * interface (see KyberSwapRouter).
 *
 * Unlike EVM addresses, Solana base58 addresses are already case-sensitive/canonical by
 * construction — there is no normalization step here (see isSolanaAddress's own comment).
 */
@Injectable()
export class SolanaWalletService {
  private readonly domain: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.domain = config.get('CORS_ORIGIN', { infer: true }).split(',')[0]!.trim();
    this.logger.setContext('SolanaWalletService');
  }

  /** Issues a fresh, single-use challenge for `address`, tied to `userId` — only the
   *  session that requested a challenge can ever consume it (see `verifyChallenge`). */
  async createChallenge(userId: string, address: string): Promise<WalletChallenge> {
    if (!isSolanaAddress(address)) throw new BadRequestException('address must be a valid Solana address');

    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + WALLET_CHALLENGE_TTL_MINUTES * 60_000);
    const message = buildSolanaSignInMessage({
      domain: this.domain,
      address,
      statement: 'Sign in to Kamby to verify wallet ownership. This request will not trigger a blockchain transaction or cost any gas.',
      nonce,
      issuedAt,
      expirationTime: expiresAt,
    });

    await prisma.solanaWalletChallenge.create({ data: { address, nonce, message, userId, expiresAt } });
    this.logger.info({ address }, 'solana wallet challenge issued');

    return { nonce, message, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Verifies a signature over a previously-issued challenge and, on success, links the
   * wallet to `userId`. Re-verifying a wallet already linked to a *different* account
   * moves the link — proving control of the private key is the only thing that matters,
   * not which session asked first. Same contract as WalletService#verifyChallenge.
   */
  async verifyChallenge(userId: string, nonce: string, signature: string): Promise<LinkedWallet> {
    const challenge = await prisma.solanaWalletChallenge.findUnique({ where: { nonce } });
    if (!challenge || challenge.userId !== userId) {
      throw new BadRequestException('Unknown challenge');
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This challenge has expired — request a new one');
    }

    const isValidSignature = verifySolanaSignature({
      address: challenge.address,
      message: challenge.message,
      signature,
    });
    if (!isValidSignature) {
      this.logger.warn({ address: challenge.address }, 'solana wallet verification failed: signature did not match');
      throw new UnauthorizedException('Signature verification failed');
    }

    // Atomic single-use consumption — same race guard as WalletService#verifyChallenge.
    const consumed = await prisma.solanaWalletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('This challenge has already been used');
    }

    const now = new Date();
    const wallet = await prisma.wallet.upsert({
      where: { address: challenge.address },
      update: { userId, verifiedAt: now, lastUsedAt: now },
      create: { address: challenge.address, chain: 'SOLANA', userId, verifiedAt: now, lastUsedAt: now, firstSeenAt: now },
    });
    this.logger.info({ address: wallet.address }, 'solana wallet verified and linked');

    return { address: wallet.address, verifiedAt: wallet.verifiedAt!.toISOString(), lastUsedAt: wallet.lastUsedAt?.toISOString() ?? null };
  }

  async listWallets(userId: string): Promise<LinkedWallet[]> {
    const wallets = await prisma.wallet.findMany({ where: { userId, chain: 'SOLANA' }, orderBy: { verifiedAt: 'desc' } });
    return wallets.map((w) => ({
      address: w.address,
      verifiedAt: w.verifiedAt!.toISOString(),
      lastUsedAt: w.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /** Detaches a wallet from the account rather than deleting the `Wallet` row — it may
   *  still hold real public trading history that must keep existing. */
  async unlinkWallet(userId: string, address: string): Promise<void> {
    if (!isSolanaAddress(address)) throw new BadRequestException('address must be a valid Solana address');

    const result = await prisma.wallet.updateMany({
      where: { address, userId, chain: 'SOLANA' },
      data: { userId: null, verifiedAt: null },
    });
    if (result.count === 0) {
      throw new NotFoundException('No verified wallet at that address is linked to your account');
    }
    this.logger.info({ address }, 'solana wallet unlinked');
  }
}
