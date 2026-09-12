import { JwtService } from '@nestjs/jwt';
import { Prisma, prisma } from '@kamby/db';
import { IdentityService } from './identity.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

describe('IdentityService', () => {
  const jwt = new JwtService({ secret: 'test-secret-at-least-16-chars' });
  const identity = new IdentityService(jwt);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new anonymous user, generating a referral code, with no referrer by default', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-1', walletAddress: null });

    const { token, userId } = await identity.createAnonymousSession();

    expect(userId).toBe('user-1');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith({
      data: { referralCode: expect.stringMatching(/^[23456789A-HJKMNP-Z]{8}$/), referredByUserId: null },
      select: { id: true },
    });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // a real JWT, not a placeholder string
  });

  it('attributes a new session to the referrer whose code was given', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'referrer-1' });
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-referred' });

    await identity.createAnonymousSession('ABCD2345');

    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { referralCode: 'ABCD2345' },
      select: { id: true },
    });
    expect(mockedPrisma.user.create).toHaveBeenCalledWith({
      data: { referralCode: expect.any(String), referredByUserId: 'referrer-1' },
      select: { id: true },
    });
  });

  it('normalizes a lowercase referral code before resolving it — codes are case-insensitive', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'referrer-1' });
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-referred' });

    await identity.createAnonymousSession('abcd2345');

    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { referralCode: 'ABCD2345' },
      select: { id: true },
    });
  });

  it('silently ignores a referral code that does not match any real user — never blocks session creation', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-1' });

    const { userId } = await identity.createAnonymousSession('NOTAREAL');

    expect(userId).toBe('user-1');
    expect(mockedPrisma.user.create).toHaveBeenCalledWith({
      data: { referralCode: expect.any(String), referredByUserId: null },
      select: { id: true },
    });
  });

  it('retries with a new code on a referral_code collision, and succeeds once one is free', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
    (mockedPrisma.user.create as jest.Mock).mockRejectedValueOnce(collision).mockResolvedValueOnce({ id: 'user-1' });

    const { userId } = await identity.createAnonymousSession();

    expect(userId).toBe('user-1');
    expect(mockedPrisma.user.create).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated collisions rather than retrying forever', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
    (mockedPrisma.user.create as jest.Mock).mockRejectedValue(collision);

    await expect(identity.createAnonymousSession()).rejects.toThrow(/unique referral code/i);
  });

  it('propagates a create failure that is not a referral_code collision, rather than retrying it', async () => {
    (mockedPrisma.user.create as jest.Mock).mockRejectedValue(new Error('DB is down'));

    await expect(identity.createAnonymousSession()).rejects.toThrow('DB is down');
    expect(mockedPrisma.user.create).toHaveBeenCalledTimes(1);
  });

  it('verifies a token it issued itself and confirms the user still exists', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-2' });
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-2' });

    const { token } = await identity.createAnonymousSession();
    const result = await identity.verifyToken(token);

    expect(result).toEqual({ id: 'user-2' });
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-2' }, select: { id: true } });
  });

  it('rejects a token signed with a different secret', async () => {
    const otherJwt = new JwtService({ secret: 'a-completely-different-secret' });
    const forged = await otherJwt.signAsync({ sub: 'user-3' });

    const result = await identity.verifyToken(forged);

    expect(result).toBeNull();
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid token', async () => {
    const result = await identity.verifyToken('not-a-real-jwt');
    expect(result).toBeNull();
  });

  it('returns null when the token is valid but the user no longer exists', async () => {
    (mockedPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-4' });
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const { token } = await identity.createAnonymousSession();
    const result = await identity.verifyToken(token);

    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const shortLivedJwt = new JwtService({ secret: 'test-secret-at-least-16-chars', signOptions: { expiresIn: '0s' } });
    const expired = await shortLivedJwt.signAsync({ sub: 'user-5' });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await identity.verifyToken(expired);

    expect(result).toBeNull();
  });
});
