import { NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { ThesisService } from './thesis.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    token: { findFirst: jest.fn() },
    tokenThesis: { findMany: jest.fn(), upsert: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    wallet: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const TOKEN_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BASE_CHAIN_ID = 8453;

describe('ThesisService', () => {
  let service: ThesisService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ThesisService();
  });

  describe('getForToken', () => {
    it('404s for an unconfigured chain id rather than querying with a meaningless filter', async () => {
      await expect(service.getForToken(999_999, TOKEN_ADDRESS, 20)).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.token.findFirst).not.toHaveBeenCalled();
    });

    it('returns an empty list when the token itself is untracked, never throwing', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getForToken(BASE_CHAIN_ID, TOKEN_ADDRESS, 20);

      expect(result).toEqual([]);
      expect(mockedPrisma.tokenThesis.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty list without touching identity lookups when no theses exist for this token', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue({ id: 'token-1' });
      (mockedPrisma.tokenThesis.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getForToken(BASE_CHAIN_ID, TOKEN_ADDRESS, 20);

      expect(result).toEqual([]);
      expect(mockedPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('resolves identity and the most-recently-used verified wallet per user, same batched pattern as the leaderboard', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue({ id: 'token-1' });
      (mockedPrisma.tokenThesis.findMany as jest.Mock).mockResolvedValue([
        { userId: 'user-1', text: 'Strong fundamentals', updatedAt: new Date('2026-09-20T00:00:00.000Z') },
      ]);
      (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'user-1', username: 'alice', avatarUrl: 'a.png' },
      ]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { userId: 'user-1', address: '0xnewer' },
        { userId: 'user-1', address: '0xolder' },
      ]);

      const result = await service.getForToken(BASE_CHAIN_ID, TOKEN_ADDRESS, 20);

      expect(result).toEqual([
        {
          userId: 'user-1',
          username: 'alice',
          avatarUrl: 'a.png',
          walletAddress: '0xnewer',
          text: 'Strong fundamentals',
          updatedAt: '2026-09-20T00:00:00.000Z',
        },
      ]);
    });

    it('never fabricates a wallet address — a thesis from a user with no verified wallet still renders, with a null address', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue({ id: 'token-1' });
      (mockedPrisma.tokenThesis.findMany as jest.Mock).mockResolvedValue([
        { userId: 'user-1', text: 'No wallet linked yet', updatedAt: new Date('2026-09-20T00:00:00.000Z') },
      ]);
      (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'user-1', username: null, avatarUrl: null }]);
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getForToken(BASE_CHAIN_ID, TOKEN_ADDRESS, 20);

      expect(result[0]?.walletAddress).toBeNull();
    });
  });

  describe('setMine', () => {
    it('404s when the token itself is untracked, never silently creating a thesis for nothing', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.setMine('user-1', BASE_CHAIN_ID, TOKEN_ADDRESS, 'text')).rejects.toThrow(NotFoundException);
      expect(mockedPrisma.tokenThesis.upsert).not.toHaveBeenCalled();
    });

    it('upserts keyed on (userId, chain, evmTokenId) — a repeat post overwrites in place, never a second row', async () => {
      (mockedPrisma.token.findFirst as jest.Mock).mockResolvedValue({ id: 'token-1' });
      (mockedPrisma.tokenThesis.upsert as jest.Mock).mockResolvedValue({
        text: 'Updated thesis',
        updatedAt: new Date('2026-09-20T00:00:00.000Z'),
      });
      (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ username: 'alice', avatarUrl: 'a.png' });
      (mockedPrisma.wallet.findFirst as jest.Mock).mockResolvedValue({ address: '0xabc' });

      const result = await service.setMine('user-1', BASE_CHAIN_ID, TOKEN_ADDRESS, 'Updated thesis');

      expect(mockedPrisma.tokenThesis.upsert).toHaveBeenCalledWith({
        where: { userId_chain_evmTokenId: { userId: 'user-1', chain: 'EVM', evmTokenId: 'token-1' } },
        create: { userId: 'user-1', chain: 'EVM', evmTokenId: 'token-1', text: 'Updated thesis' },
        update: { text: 'Updated thesis' },
      });
      expect(result).toEqual({
        userId: 'user-1',
        username: 'alice',
        avatarUrl: 'a.png',
        walletAddress: '0xabc',
        text: 'Updated thesis',
        updatedAt: '2026-09-20T00:00:00.000Z',
      });
    });
  });
});
