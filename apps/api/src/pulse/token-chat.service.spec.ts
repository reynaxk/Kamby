import { prisma } from '@kamby/db';
import { TOKEN_CHAT_REALTIME_CHANNEL } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { TokenChatService } from './token-chat.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    wallet: { count: jest.fn() },
    pumpFunToken: { findUnique: jest.fn() },
    pulseMessage: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    pulseReport: { create: jest.fn() },
    solanaTradeTransaction: { findMany: jest.fn() },
    tradeTransaction: { findMany: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const KEY = `solana:${WIF}`;
const sam = { username: 'sam', avatarUrl: null, wallets: [{ address: 'So1Wallet' }] };

function messageRow(data: Record<string, unknown>) {
  return { id: 'm1', body: '', kind: 'text', pnl: null, badges: [], createdAt: new Date('2026-10-14T12:00:00Z'), hiddenAt: null, userId: 'u1', user: sam, ...data };
}

describe('TokenChatService', () => {
  let redis: { set: jest.Mock; publish: jest.Mock };
  let positions: { getMine: jest.Mock };
  let service: TokenChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = { set: jest.fn().mockResolvedValue('OK'), publish: jest.fn().mockResolvedValue(1) };
    positions = { getMine: jest.fn().mockResolvedValue([]) };
    const leaderboard = { getLeaderboard: jest.fn().mockResolvedValue({ entries: [{ userId: 'u1', realizedPnlUsd: 50 }] }) };
    service = new TokenChatService(redis as never, positions as never, leaderboard as never, logger);
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ username: 'sam' });
    (mockedPrisma.pulseMessage.findFirst as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.pumpFunToken.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.pulseMessage.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(messageRow(data)));
  });

  it("posts to the coin's room with the poster's badges, and sends it out live", async () => {
    positions.getMine.mockResolvedValue([{ tokenAddress: WIF, chainIdentifier: 'solana', currentValueUsd: 1500, costBasisUsd: 900 }]);
    const item = await service.post('u1', KEY, ' $WIF   sending ');
    expect(mockedPrisma.pulseMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: { userId: 'u1', tokenKey: KEY, body: '$WIF sending', badges: ['whale', 'top'] } }));
    expect(item).toMatchObject({ kind: 'message', body: '$WIF sending', badges: ['whale', 'top'] });
    expect(redis.publish).toHaveBeenCalledWith(TOKEN_CHAT_REALTIME_CHANNEL, expect.stringContaining('"type":"item"'));
  });

  it('refuses a malformed coin and links', async () => {
    await expect(service.post('u1', 'solana:nope', 'gm')).rejects.toThrow(/Unknown coin/);
    await expect(service.post('u1', KEY, 'claim at www.scam.io')).rejects.toThrow(/Links/);
  });

  it('builds a PnL flex from the real position only', async () => {
    await expect(service.postPnl('u1', KEY)).rejects.toThrow(/don't hold/);
    positions.getMine.mockResolvedValue([{ tokenAddress: WIF, chainIdentifier: 'solana', symbol: 'WIF', logoUrl: null, currentValueUsd: 150, costBasisUsd: 50 }]);
    const item = await service.postPnl('u1', KEY);
    expect(item).toMatchObject({ kind: 'pnl', pnl: { pnlUsd: 100, pnlPct: 200, investedUsd: 50, valueUsd: 150 } });
  });

  it('hides a message for everyone at the third report', async () => {
    (mockedPrisma.pulseMessage.findUnique as jest.Mock).mockResolvedValue({ id: 'm1', userId: 'other', tokenKey: KEY, hiddenAt: null });
    (mockedPrisma.pulseMessage.update as jest.Mock).mockResolvedValueOnce({ reportCount: 2 }).mockResolvedValueOnce({ reportCount: 3 }).mockResolvedValue({});
    expect(await service.report('u1', 'm1')).toEqual({ hidden: false });
    expect(await service.report('u2', 'm1')).toEqual({ hidden: true });
    expect(redis.publish).toHaveBeenCalledWith(TOKEN_CHAT_REALTIME_CHANNEL, JSON.stringify({ type: 'hide', tokenKey: KEY, id: 'm1' }));
  });

  it('only relays known reactions', async () => {
    await service.react('u1', KEY, '🚀');
    expect(redis.publish).toHaveBeenCalledWith(TOKEN_CHAT_REALTIME_CHANNEL, JSON.stringify({ type: 'reaction', tokenKey: KEY, emoji: '🚀' }));
    await expect(service.react('u1', KEY, '<script>')).rejects.toThrow(/reactions/);
  });

  it("merges the coin's messages with its Kamby trades, oldest first", async () => {
    (mockedPrisma.pulseMessage.findMany as jest.Mock).mockResolvedValue([messageRow({ body: 'gm', tokenKey: KEY, createdAt: new Date('2026-10-14T12:05:00Z') })]);
    (mockedPrisma.solanaTradeTransaction.findMany as jest.Mock).mockResolvedValue([
      { id: 't1', side: 'BUY', inputAmount: '50000000', expectedOutputAmount: '1', confirmedAt: new Date('2026-10-14T12:00:00Z'), submittedAt: new Date(), user: sam },
    ]);
    const items = await service.list(KEY);
    expect(items.map((i) => i.kind)).toEqual(['trade', 'message']);
    expect(items[0]).toMatchObject({ side: 'BUY', usd: 50 });
  });
});
