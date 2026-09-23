import type { Redis } from 'ioredis';
import { RealtimeService } from './realtime.service';

/** A minimal, real event-registering fake — captures the handlers RealtimeService actually
 *  registers via `.on(event, handler)` so a test can fire them directly (simulating a real
 *  incoming pub/sub message), rather than needing a real Redis connection. */
function fakeSubscriber() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    emit(event: string, ...args: unknown[]) {
      handlers.get(event)?.(...args);
    },
  };
}

function fakeLogger() {
  return { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

describe('RealtimeService', () => {
  let subscriber: ReturnType<typeof fakeSubscriber>;
  let redis: { duplicate: jest.Mock };
  let logger: ReturnType<typeof fakeLogger>;
  let service: RealtimeService;

  beforeEach(() => {
    subscriber = fakeSubscriber();
    redis = { duplicate: jest.fn().mockReturnValue(subscriber) };
    logger = fakeLogger();
    service = new RealtimeService(redis as unknown as Redis, logger as never);
  });

  it('subscribes to all three real-time channels on module init', async () => {
    await service.onModuleInit();

    expect(subscriber.subscribe).toHaveBeenCalledWith(
      'kamby:activity:new',
      'kamby:notifications:new',
      'kamby:solana-activity:new',
    );
  });

  it('routes an activity message to activityEvents$, not the other two subjects', async () => {
    await service.onModuleInit();
    const received: unknown[] = [];
    service.activityEvents$.subscribe((e) => received.push(e));
    const notificationReceived: unknown[] = [];
    service.notificationEvents$.subscribe((e) => notificationReceived.push(e));

    const ping = { tokenMarketId: 'market-1', count: 3, atIso: '2026-01-01T00:00:00.000Z' };
    subscriber.emit('message', 'kamby:activity:new', JSON.stringify(ping));

    expect(received).toEqual([ping]);
    expect(notificationReceived).toEqual([]);
  });

  it('routes a notification message to notificationEvents$ only', async () => {
    await service.onModuleInit();
    const received: unknown[] = [];
    service.notificationEvents$.subscribe((e) => received.push(e));

    const ping = { userId: 'user-1', notificationId: 'notif-1', type: 'FOLLOW', atIso: '2026-01-01T00:00:00.000Z' };
    subscriber.emit('message', 'kamby:notifications:new', JSON.stringify(ping));

    expect(received).toEqual([ping]);
  });

  it('routes a Solana activity message to solanaActivityEvents$ only', async () => {
    await service.onModuleInit();
    const received: unknown[] = [];
    service.solanaActivityEvents$.subscribe((e) => received.push(e));

    const ping = { transactionId: 'tx-1', atIso: '2026-01-01T00:00:00.000Z' };
    subscriber.emit('message', 'kamby:solana-activity:new', JSON.stringify(ping));

    expect(received).toEqual([ping]);
  });

  it('drops a malformed message and logs a warning, never crashing or emitting garbage', async () => {
    await service.onModuleInit();
    const received: unknown[] = [];
    service.activityEvents$.subscribe((e) => received.push(e));

    expect(() => subscriber.emit('message', 'kamby:activity:new', 'not real json{{{')).not.toThrow();
    expect(received).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('silently ignores a message on an unrecognized channel rather than emitting it anywhere', async () => {
    await service.onModuleInit();
    const activityReceived: unknown[] = [];
    service.activityEvents$.subscribe((e) => activityReceived.push(e));

    expect(() => subscriber.emit('message', 'kamby:some-other-channel', '{}')).not.toThrow();
    expect(activityReceived).toEqual([]);
  });

  it('does not crash module init when the initial subscribe call fails — Redis being down at boot must not take the API down', async () => {
    subscriber.subscribe.mockRejectedValue(new Error('Redis unreachable'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('closes the dedicated subscriber connection on module destroy', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('does not throw on module destroy if module init never ran (subscriber never created)', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
