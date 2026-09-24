import { Prisma, prisma } from '@kamby/db';
import { NOTIFICATION_REALTIME_CHANNEL } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { NotificationService } from './notification.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      wallet: { findUnique: jest.fn() },
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      notificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    },
  };
});
// toNotificationDto has its own dedicated coverage in notification.mapper.spec.ts — mocked
// here (to a shape carrying just the row's id through) so NotificationService#list's tests
// exercise only this service's own pagination/cursor logic.
jest.mock('./notification.mapper', () => ({
  NOTIFICATION_INCLUDE: {},
  toNotificationDto: (row: { id: string }) => ({ id: row.id }),
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const RECIPIENT_USER_ID = 'recipient-1';
const ACTOR_USER_ID = 'actor-1';
const WALLET = '0x1234567890123456789012345678901234567890';

function fakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;
}

function fakeRedis() {
  return {
    publish: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK'),
    getdel: jest.fn(),
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('NotificationService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = fakeRedis();
    service = new NotificationService(redis as never, fakeLogger());
  });

  describe('notifyFollow', () => {
    it("creates a FOLLOW notification for the followed wallet's linked user", async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
      });
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null); // defaults -> enabled
      (mockedPrisma.notification.create as jest.Mock).mockResolvedValue({
        id: 'notif-1',
        userId: RECIPIENT_USER_ID,
        type: 'FOLLOW',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: RECIPIENT_USER_ID,
          type: 'FOLLOW',
          dedupeKey: `follower:${ACTOR_USER_ID}`,
          actorUserId: ACTOR_USER_ID,
        },
      });
      expect(redis.publish).toHaveBeenCalledWith(
        NOTIFICATION_REALTIME_CHANNEL,
        JSON.stringify({
          userId: RECIPIENT_USER_ID,
          notificationId: 'notif-1',
          type: 'FOLLOW',
          atIso: '2026-01-01T00:00:00.000Z',
        }),
      );
    });

    it('does nothing when the followed wallet has no linked account', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: null });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('never self-notifies when a user follows their own linked wallet', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: ACTOR_USER_ID });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('respects the recipient\'s disabled "follows" preference', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
      });
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
        follows: false,
        likes: true,
        followedTraderTrades: true,
        whaleTrades: true,
        trendingTokens: true,
      });

      await service.notifyFollow(ACTOR_USER_ID, WALLET);

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyLike', () => {
    it('does nothing for a swap with no attributable trader', async () => {
      await service.notifyLike(ACTOR_USER_ID, { id: 'swap-1', traderAddress: null });

      expect(mockedPrisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });

    it("never self-notifies a like on one's own trade", async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: ACTOR_USER_ID });

      await service.notifyLike(ACTOR_USER_ID, { id: 'swap-1', traderAddress: WALLET });

      expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('create (idempotency)', () => {
    it('treats a unique-constraint violation as a silent no-op, not an error', async () => {
      (mockedPrisma.notification.create as jest.Mock).mockRejectedValue(uniqueConstraintError());

      await expect(
        service.create({
          userId: RECIPIENT_USER_ID,
          type: 'LIKE',
          dedupeKey: 'k',
          actorUserId: ACTOR_USER_ID,
        }),
      ).resolves.toBeUndefined();
      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('still throws a genuine, unexpected database error', async () => {
      (mockedPrisma.notification.create as jest.Mock).mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.create({ userId: RECIPIENT_USER_ID, type: 'LIKE', dedupeKey: 'k' }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('markRead — IDOR safety', () => {
    it("scopes the update to both the notification id AND the caller's own userId", async () => {
      (mockedPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.markRead(RECIPIENT_USER_ID, 'notif-1');

      expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: RECIPIENT_USER_ID, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('preferences', () => {
    it('returns the shipped defaults when no preference row exists yet', async () => {
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null);

      const prefs = await service.getPreferences(RECIPIENT_USER_ID);

      expect(prefs).toEqual({
        follows: true,
        likes: true,
        followedTraderTrades: true,
        whaleTrades: true,
        trendingTokens: true,
        watchedTokenActivity: true,
      });
    });

    it('merges a partial update onto the current preferences rather than replacing them', async () => {
      (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null); // current = defaults
      (mockedPrisma.notificationPreference.upsert as jest.Mock).mockResolvedValue({
        userId: RECIPIENT_USER_ID,
        follows: true,
        likes: true,
        followedTraderTrades: true,
        whaleTrades: false,
        trendingTokens: true,
        watchedTokenActivity: true,
      });

      await service.updatePreferences(RECIPIENT_USER_ID, { whaleTrades: false });

      expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId: RECIPIENT_USER_ID },
        create: {
          userId: RECIPIENT_USER_ID,
          follows: true,
          likes: true,
          followedTraderTrades: true,
          whaleTrades: false,
          trendingTokens: true,
          watchedTokenActivity: true,
        },
        update: {
          follows: true,
          likes: true,
          followedTraderTrades: true,
          whaleTrades: false,
          trendingTokens: true,
          watchedTokenActivity: true,
        },
      });
    });
  });

  describe('list', () => {
    // decodeNotificationCursor is the real function (not mocked) and validates id as a real
    // UUID — a bare '1'/'2' id would silently fail that validation and be treated as no
    // cursor at all, so every id here must look like a genuine one.
    const ID_1 = '11111111-1111-1111-1111-111111111111';
    const ID_2 = '22222222-2222-2222-2222-222222222222';
    const ID_3 = '33333333-3333-3333-3333-333333333333';

    function fakeRow(id: string, createdAt: Date) {
      return { id, createdAt };
    }

    it('returns a null nextCursor and every row when there are fewer rows than the limit', async () => {
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([
        fakeRow(ID_1, new Date('2026-01-03')),
        fakeRow(ID_2, new Date('2026-01-02')),
      ]);

      const result = await service.list(RECIPIENT_USER_ID, undefined, 10);

      expect(result).toEqual({ items: [{ id: ID_1 }, { id: ID_2 }], nextCursor: null });
    });

    it('returns exactly `limit` items and a real nextCursor when there are more rows than the page size', async () => {
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([
        fakeRow(ID_1, new Date('2026-01-03')),
        fakeRow(ID_2, new Date('2026-01-02')),
        fakeRow(ID_3, new Date('2026-01-01')),
      ]);

      const result = await service.list(RECIPIENT_USER_ID, undefined, 2);

      expect(result.items).toEqual([{ id: ID_1 }, { id: ID_2 }]);
      expect(result.nextCursor).not.toBeNull();
      expect(mockedPrisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 })); // limit + 1
    });

    it('scopes every query to the real caller userId, never a client-supplied one', async () => {
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(RECIPIENT_USER_ID, undefined, 10);

      expect(mockedPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ userId: RECIPIENT_USER_ID }, {}] } }),
      );
    });

    it('a real nextCursor, decoded and reused, requests strictly older rows OR same-instant rows with a strictly smaller id', async () => {
      // The tie-breaking half of this cursor (same createdAt, smaller id) doesn't exist on
      // TraderService's simpler `lt`-only cursor — two notifications can share a createdAt,
      // so this OR shape is the real, distinct behavior worth locking in here.
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValueOnce([
        fakeRow(ID_1, new Date('2026-01-03')),
        fakeRow(ID_2, new Date('2026-01-02')),
        fakeRow(ID_3, new Date('2026-01-01')),
      ]);
      const firstPage = await service.list(RECIPIENT_USER_ID, undefined, 2);
      expect(firstPage.nextCursor).not.toBeNull();

      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValueOnce([]);
      await service.list(RECIPIENT_USER_ID, firstPage.nextCursor!, 2);

      expect(mockedPrisma.notification.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { userId: RECIPIENT_USER_ID },
              {
                OR: [
                  { createdAt: { lt: new Date('2026-01-02') } },
                  { createdAt: new Date('2026-01-02'), id: { lt: ID_2 } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('treats a malformed cursor as "start from the beginning," never a 500', async () => {
      (mockedPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(RECIPIENT_USER_ID, 'not-real-base64url-json', 10);

      expect(mockedPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ userId: RECIPIENT_USER_ID }, {}] } }),
      );
    });
  });

  describe('unreadCount', () => {
    it('counts only this real caller\'s own unread notifications', async () => {
      (mockedPrisma.notification.count as jest.Mock).mockResolvedValue(5);

      const count = await service.unreadCount(RECIPIENT_USER_ID);

      expect(count).toBe(5);
      expect(mockedPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: RECIPIENT_USER_ID, readAt: null },
      });
    });
  });

  describe('markAllRead', () => {
    it("marks every one of the real caller's own unread notifications read, never another user's", async () => {
      (mockedPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      await service.markAllRead(RECIPIENT_USER_ID);

      expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: RECIPIENT_USER_ID, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('SSE stream tickets', () => {
    it('issues a single-use ticket with a bounded TTL', async () => {
      const ticket = await service.issueStreamTicket(RECIPIENT_USER_ID);

      expect(typeof ticket).toBe('string');
      expect(ticket.length).toBeGreaterThan(16);
      expect(redis.set).toHaveBeenCalledWith(
        `notif:ticket:${ticket}`,
        RECIPIENT_USER_ID,
        'EX',
        expect.any(Number),
      );
    });

    it('consumes a ticket via an atomic get-and-delete', async () => {
      redis.getdel.mockResolvedValue(RECIPIENT_USER_ID);

      const userId = await service.consumeStreamTicket('some-ticket');

      expect(userId).toBe(RECIPIENT_USER_ID);
      expect(redis.getdel).toHaveBeenCalledWith('notif:ticket:some-ticket');
    });
  });
});
