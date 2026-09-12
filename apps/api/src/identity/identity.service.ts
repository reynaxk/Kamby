import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, prisma } from '@kamby/db';
import { randomBytes } from 'node:crypto';

interface SessionPayload {
  sub: string;
}

export interface SessionUser {
  id: string;
}

/** Unambiguous 31-symbol alphabet (digits 2-9, letters A-Z excluding I/L/O) — a referral
 *  code is meant to be typed or read aloud from a shared link, so avoiding lookalike
 *  characters is worth the small entropy cost. 8 symbols from this alphabet is
 *  31^8 ≈ 8.5 * 10^11 combinations — the bounded-retry collision handling in
 *  createAnonymousSession below is defensive, not something expected to ever actually
 *  retry in practice. */
const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REFERRAL_CODE_LENGTH = 8;
const MAX_REFERRAL_CODE_ATTEMPTS = 5;

function generateReferralCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[bytes[i]! % REFERRAL_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Owns Phase 2's minimal session mechanism — see docs/SOCIAL.md#authentication for exactly
 * what it does and doesn't prove. It issues an anonymous session (a fresh User row, no
 * wallet-ownership claim made or trusted) so follows/likes are real and attributable
 * per-session without building the full email/passkey + SIWE login docs/WALLET_SECURITY.md
 * describes as Phase 2's eventual real login.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * `referredByCode`, if given, is the referral code from the link the browser first
   * arrived on — see docs/REFERRALS.md#attribution. Resolved to a real user id here, at
   * the one moment a new identity is actually created; an unknown or malformed code is
   * silently ignored (a broken referral link should never block someone from using the
   * app) rather than rejecting session creation over it.
   */
  async createAnonymousSession(referredByCode?: string): Promise<{ token: string; userId: string }> {
    const referrer = referredByCode
      ? await prisma.user.findUnique({ where: { referralCode: referredByCode.toUpperCase() }, select: { id: true } })
      : null;

    let user: { id: string } | null = null;
    for (let attempt = 0; attempt < MAX_REFERRAL_CODE_ATTEMPTS && !user; attempt++) {
      try {
        user = await prisma.user.create({
          data: { referralCode: generateReferralCode(), referredByUserId: referrer?.id ?? null },
          select: { id: true },
        });
      } catch (error) {
        // P2002: unique constraint — only ever the referral_code collision this loop
        // exists to retry; any other create failure is a real error and must propagate.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
    if (!user) throw new Error('Could not generate a unique referral code after several attempts');

    const payload: SessionPayload = { sub: user.id };
    const token = await this.jwt.signAsync(payload);
    return { token, userId: user.id };
  }

  /**
   * Verifies a bearer token and confirms the user it names still exists. Never throws —
   * an invalid, expired, or stale token is simply "no user," same as no token at all. The
   * database round trip (rather than trusting the JWT's claim alone) is deliberate: a
   * token's `sub` is client-controlled in the sense that the client presents it, and the
   * server must confirm the entity it names is still real before honoring it — see
   * docs/SOCIAL.md#security.
   */
  async verifyToken(token: string): Promise<SessionUser | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return null;
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
  }
}
