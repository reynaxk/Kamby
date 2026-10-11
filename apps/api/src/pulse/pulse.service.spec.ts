import { prisma } from '@kamby/db';
import { PULSE_REALTIME_CHANNEL } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { PulseService } from './pulse.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    pulseMessage: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;

function row(body: string) {
  return { id: 'm1', body, createdAt: new Date('2026-10-11T12:00:00Z'), hiddenAt: null, userId: 'u1', user: { username: 'sam', avatarUrl: null, wallets: [{ address: 'So1Wallet' }] } };
}

describe('PulseService', () => {
  let redis: { set: jest.Mock; publish: jest.Mock };
  let service: PulseService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = { set: jest.fn().mockResolvedValue('OK'), publish: jest.fn().mockResolvedValue(1) };
    service = new PulseService(redis as never, logger);
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ username: 'sam' });
    (mockedPrisma.pulseMessage.findFirst as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.pulseMessage.create as jest.Mock).mockImplementation(({ data }: { data: { body: string } }) => Promise.resolve(row(data.body)));
  });

  it('saves a normal message, tidied, and sends it out live', async () => {
    const message = await service.post('u1', '  $WIF   about to run  ');
    expect(mockedPrisma.pulseMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: { userId: 'u1', body: '$WIF about to run' } }));
    expect(message).toMatchObject({ body: '$WIF about to run', author: { username: 'sam', address: 'So1Wallet' } });
    expect(redis.publish).toHaveBeenCalledWith(PULSE_REALTIME_CHANNEL, expect.stringContaining('$WIF about to run'));
  });

  it('refuses links, empty and over-long messages', async () => {
    await expect(service.post('u1', 'free airdrop at https://scam.xyz')).rejects.toThrow(/Links aren't allowed/);
    await expect(service.post('u1', '   ')).rejects.toThrow(/Write something/);
    await expect(service.post('u1', 'a'.repeat(281))).rejects.toThrow(/under 280/);
    expect(mockedPrisma.pulseMessage.create).not.toHaveBeenCalled();
  });

  it('needs a username', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ username: null });
    await expect(service.post('u1', 'gm')).rejects.toThrow(/Set a username/);
  });

  it('slows down a fast poster and refuses a repeat', async () => {
    redis.set.mockResolvedValueOnce(null);
    await expect(service.post('u1', 'gm')).rejects.toThrow(/Slow down/);
    (mockedPrisma.pulseMessage.findFirst as jest.Mock).mockResolvedValue({ body: 'GM' });
    await expect(service.post('u1', 'gm')).rejects.toThrow(/You just said that/);
  });

  it('pages newest first and says where older ones start', async () => {
    (mockedPrisma.pulseMessage.findMany as jest.Mock).mockResolvedValue([row('3'), row('2'), row('1')]);
    const page = await service.list(undefined, 2);
    expect(page.items.map((m) => m.body)).toEqual(['3', '2']);
    expect(page.nextBefore).toBe('2026-10-11T12:00:00.000Z');
  });
});
