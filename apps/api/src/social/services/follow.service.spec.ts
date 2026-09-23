import { NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { FollowService } from './follow.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      wallet: { findUnique: jest.fn() },
      follow: { create: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
// Mixed-case on purpose — real EVM addresses arrive from callers in any casing, and
// normalizeEvmAddress (a plain .toLowerCase()) is what makes "following" the same wallet
// idempotent regardless of how it's cased on any given request.
const MIXED_CASE_ADDRESS = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
const LOWER_ADDRESS = MIXED_CASE_ADDRESS.toLowerCase();

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('FollowService', () => {
  let service: FollowService;
  let notifyFollow: jest.Mock;
  let logger: { setContext: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    notifyFollow = jest.fn().mockResolvedValue(undefined);
    logger = { setContext: jest.fn(), error: jest.fn() };
    service = new FollowService({ notifyFollow } as never, logger as never);
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ address: LOWER_ADDRESS });
  });

  describe('follow', () => {
    it('throws NotFoundException for a wallet that has never traded, never touching follow at all', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.follow(USER_ID, MIXED_CASE_ADDRESS)).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.follow.create).not.toHaveBeenCalled();
    });

    it('normalizes a mixed-case address before every query, so casing never creates a duplicate row', async () => {
      (mockedPrisma.follow.create as jest.Mock).mockResolvedValue({ id: 'follow-1' });

      await service.follow(USER_ID, MIXED_CASE_ADDRESS);

      expect(mockedPrisma.wallet.findUnique).toHaveBeenCalledWith({ where: { address: LOWER_ADDRESS } });
      expect(mockedPrisma.follow.create).toHaveBeenCalledWith({ data: { userId: USER_ID, walletAddress: LOWER_ADDRESS } });
    });

    it('fires a notification on a genuine new follow', async () => {
      (mockedPrisma.follow.create as jest.Mock).mockResolvedValue({ id: 'follow-1' });

      await service.follow(USER_ID, MIXED_CASE_ADDRESS);

      expect(notifyFollow).toHaveBeenCalledWith(USER_ID, LOWER_ADDRESS);
    });

    it('is idempotent on a duplicate follow — succeeds silently, never notifies twice', async () => {
      (mockedPrisma.follow.create as jest.Mock).mockRejectedValue(uniqueConstraintError());

      await expect(service.follow(USER_ID, MIXED_CASE_ADDRESS)).resolves.toBeUndefined();
      expect(notifyFollow).not.toHaveBeenCalled();
    });

    it('re-throws a real (non-duplicate) database error rather than swallowing it', async () => {
      (mockedPrisma.follow.create as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(service.follow(USER_ID, MIXED_CASE_ADDRESS)).rejects.toThrow('connection lost');
    });

    it('never fails the follow itself when the notification fails — logs instead', async () => {
      (mockedPrisma.follow.create as jest.Mock).mockResolvedValue({ id: 'follow-1' });
      notifyFollow.mockRejectedValue(new Error('notification service down'));

      await expect(service.follow(USER_ID, MIXED_CASE_ADDRESS)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('unfollow', () => {
    it('deletes the matching row using the normalized address', async () => {
      (mockedPrisma.follow.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unfollow(USER_ID, MIXED_CASE_ADDRESS);

      expect(mockedPrisma.follow.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, walletAddress: LOWER_ADDRESS } });
    });

    it('is a no-op, not an error, when there was nothing to unfollow', async () => {
      (mockedPrisma.follow.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.unfollow(USER_ID, MIXED_CASE_ADDRESS)).resolves.toBeUndefined();
    });
  });

  describe('isFollowing', () => {
    it('returns null (not a fabricated false) when there is no viewer to check against', async () => {
      const result = await service.isFollowing(null, MIXED_CASE_ADDRESS);

      expect(result).toBeNull();
      expect(mockedPrisma.follow.findUnique).not.toHaveBeenCalled();
    });

    it('returns true when a follow row exists', async () => {
      (mockedPrisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'follow-1' });

      const result = await service.isFollowing(USER_ID, MIXED_CASE_ADDRESS);

      expect(result).toBe(true);
      expect(mockedPrisma.follow.findUnique).toHaveBeenCalledWith({
        where: { userId_walletAddress: { userId: USER_ID, walletAddress: LOWER_ADDRESS } },
        select: { id: true },
      });
    });

    it('returns false, not null, when the viewer is known but is not following', async () => {
      (mockedPrisma.follow.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.isFollowing(USER_ID, MIXED_CASE_ADDRESS);

      expect(result).toBe(false);
    });
  });
});
