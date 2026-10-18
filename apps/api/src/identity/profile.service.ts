import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { isValidUsername, normalizeUsername } from '@kamby/domain';
import { R2StorageService, type UploadableFile } from '../media/r2-storage.service';

export interface ProfileDto {
  username: string | null;
  avatarUrl: string | null;
}

/**
 * The self-serve identity surface — see the "Identity: username + PFP" section of the
 * realized-PnL/leaderboard plan and docs/TRADER_INTELLIGENCE.md#realized-pnl. Both mutation
 * paths write straight to `User` (never `Wallet` — see Wallet's own doc comment in
 * packages/domain/src/wallet.ts for why identity lives here, one handle across a user's
 * several verified wallets).
 *
 * `uploadAvatar` deliberately persists `avatarUrl` itself in the same call, rather than
 * returning R2's public URL for the client to PATCH back in a second request: an
 * arbitrary client-supplied `avatarUrl` would let anyone point their profile at any URL on
 * the internet (hotlinking/tracking-pixel abuse, and a way to route around the content-type
 * validation R2StorageService already enforces) — a real, if minor, abuse surface this
 * shape closes for free. `updateProfile` below therefore only ever accepts `username`.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly r2: R2StorageService) {}

  /** The current session's own profile — how the frontend knows whether to show the
   *  onboarding "set up your profile" prompt (`username === null`) and what to pre-fill
   *  on the self-serve account page. `userId` always comes from an already-verified JWT
   *  (see JwtAuthGuard), so a missing row here would mean the session outlived its own
   *  user — genuinely shouldn't happen; surfaced loudly rather than papered over with a
   *  silent null fallback. */
  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, avatarUrl: true } });
    if (!user) throw new UnauthorizedException('Session user no longer exists.');
    return user;
  }

  /**
   * "Send to a Kamby user" (2026-10-15): who @username is and where their money goes — their
   * verified EVM wallet (Base, BNB, Robinhood) and Solana wallet. Only for signed-in users; never
   * yourself (that's a withdrawal).
   */
  async recipient(requesterId: string, rawUsername: string): Promise<{ username: string; avatarUrl: string | null; evmAddress: string | null; solanaAddress: string | null }> {
    const username = normalizeUsername(rawUsername.replace(/^@/, ''));
    if (!isValidUsername(username)) throw new NotFoundException('No Kamby user with that name.');
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, avatarUrl: true, wallets: { where: { verifiedAt: { not: null } }, orderBy: { lastUsedAt: 'desc' }, select: { address: true, chain: true } } },
    });
    if (!user?.username) throw new NotFoundException('No Kamby user with that name.');
    if (user.id === requesterId) throw new BadRequestException("That's you — pick someone else.");
    return {
      username: user.username,
      avatarUrl: user.avatarUrl,
      evmAddress: user.wallets.find((w) => w.chain === 'EVM')?.address ?? null,
      solanaAddress: user.wallets.find((w) => w.chain === 'SOLANA')?.address ?? null,
    };
  }

  async updateProfile(userId: string, rawUsername: string): Promise<ProfileDto> {
    const username = normalizeUsername(rawUsername);
    if (!isValidUsername(username)) {
      throw new BadRequestException(
        'Username must be 3-20 characters — lowercase letters, numbers, and underscores only — and not a reserved name.',
      );
    }

    try {
      return await prisma.user.update({
        where: { id: userId },
        data: { username },
        select: { username: true, avatarUrl: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Username "${username}" is already taken.`);
      }
      throw error;
    }
  }

  async uploadAvatar(userId: string, file: UploadableFile, apiOrigin?: string): Promise<ProfileDto> {
    const avatarUrl = await this.r2.uploadAvatar(userId, file, apiOrigin);
    return prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { username: true, avatarUrl: true },
    });
  }
}
