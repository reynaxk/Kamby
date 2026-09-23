import { NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { LikeService } from './like.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      swap: { findUnique: jest.fn() },
      activityLike: { create: jest.fn(), deleteMany: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const SWAP_ID = 'swap-1';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('LikeService', () => {
  let service: LikeService;
  let notifyLike: jest.Mock;
  let logger: { setContext: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    notifyLike = jest.fn().mockResolvedValue(undefined);
    logger = { setContext: jest.fn(), error: jest.fn() };
    service = new LikeService({ notifyLike } as never, logger as never);
    (mockedPrisma.swap.findUnique as jest.Mock).mockResolvedValue({ id: SWAP_ID, traderAddress: '0xabc' });
  });

  describe('like', () => {
    it('throws NotFoundException for a swap that does not exist, never touching activityLike at all', async () => {
      (mockedPrisma.swap.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.like(USER_ID, SWAP_ID)).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.activityLike.create).not.toHaveBeenCalled();
    });

    it('creates the like and fires a notification on a genuine new like', async () => {
      (mockedPrisma.activityLike.create as jest.Mock).mockResolvedValue({ id: 'like-1' });

      await service.like(USER_ID, SWAP_ID);

      expect(mockedPrisma.activityLike.create).toHaveBeenCalledWith({ data: { userId: USER_ID, swapId: SWAP_ID } });
      expect(notifyLike).toHaveBeenCalledWith(USER_ID, { id: SWAP_ID, traderAddress: '0xabc' });
    });

    it('is idempotent on a duplicate like — succeeds silently, never notifies twice', async () => {
      (mockedPrisma.activityLike.create as jest.Mock).mockRejectedValue(uniqueConstraintError());

      await expect(service.like(USER_ID, SWAP_ID)).resolves.toBeUndefined();
      expect(notifyLike).not.toHaveBeenCalled();
    });

    it('re-throws a real (non-duplicate) database error rather than swallowing it', async () => {
      (mockedPrisma.activityLike.create as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(service.like(USER_ID, SWAP_ID)).rejects.toThrow('connection lost');
    });

    it('never fails the like itself when the notification fails — logs instead', async () => {
      (mockedPrisma.activityLike.create as jest.Mock).mockResolvedValue({ id: 'like-1' });
      notifyLike.mockRejectedValue(new Error('notification service down'));

      await expect(service.like(USER_ID, SWAP_ID)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('unlike', () => {
    it('deletes the matching like row', async () => {
      (mockedPrisma.activityLike.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unlike(USER_ID, SWAP_ID);

      expect(mockedPrisma.activityLike.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID, swapId: SWAP_ID } });
    });

    it('is a no-op, not an error, when there was nothing to unlike', async () => {
      (mockedPrisma.activityLike.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.unlike(USER_ID, SWAP_ID)).resolves.toBeUndefined();
    });
  });
});
