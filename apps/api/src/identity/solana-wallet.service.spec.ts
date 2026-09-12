import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { prisma } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { SolanaWalletService } from './solana-wallet.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    solanaWalletChallenge: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    wallet: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

// A real Ed25519 keypair, generated fresh for this test file only — never funded, never
// used anywhere but here. Same "real crypto, never mocked" principle wallet.service.spec.ts
// applies for EVM (there via a well-known Hardhat/Anvil test account; here there's no
// equivalent well-known Solana test key, so a fresh keypair fills the same role).
const TEST_KEYPAIR = nacl.sign.keyPair();
const TEST_ADDRESS = bs58.encode(TEST_KEYPAIR.publicKey);

function sign(message: string): string {
  const signature = nacl.sign.detached(new TextEncoder().encode(message), TEST_KEYPAIR.secretKey);
  return bs58.encode(signature);
}

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = { CORS_ORIGIN: 'https://kamby.app,https://staging.kamby.app' };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('SolanaWalletService', () => {
  let service: SolanaWalletService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SolanaWalletService(fakeConfig(), fakeLogger());
  });

  describe('createChallenge', () => {
    it('rejects a malformed address before touching the database', async () => {
      await expect(service.createChallenge('user-1', 'not-an-address')).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.solanaWalletChallenge.create).not.toHaveBeenCalled();
    });

    it('issues a nonce, an expiring message naming the configured domain, and persists it tied to the caller', async () => {
      (mockedPrisma.solanaWalletChallenge.create as jest.Mock).mockResolvedValue({});

      const challenge = await service.createChallenge('user-1', TEST_ADDRESS);

      expect(challenge.nonce).toHaveLength(32); // 16 bytes hex-encoded
      expect(challenge.message).toContain('kamby.app wants you to sign in');
      // Unlike EVM, Solana base58 addresses are never lowercased — the message must carry
      // the address byte-for-byte as given.
      expect(challenge.message).toContain(TEST_ADDRESS);
      expect(new Date(challenge.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(mockedPrisma.solanaWalletChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', address: TEST_ADDRESS }) }),
      );
    });
  });

  describe('verifyChallenge', () => {
    async function issuedChallenge(userId = 'user-1') {
      let stored: { id: string; address: string; nonce: string; message: string; userId: string; expiresAt: Date; usedAt: Date | null } | undefined;
      (mockedPrisma.solanaWalletChallenge.create as jest.Mock).mockImplementation(({ data }: { data: typeof stored }) => {
        stored = { id: 'challenge-1', usedAt: null, ...data } as typeof stored;
        return Promise.resolve(stored);
      });
      const challenge = await service.createChallenge(userId, TEST_ADDRESS);
      (mockedPrisma.solanaWalletChallenge.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(stored));
      return { challenge, get stored() { return stored!; } };
    }

    it('links the wallet to the caller after a valid signature and consumes the nonce', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = sign(challenge.message);
      (mockedPrisma.solanaWalletChallenge.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockedPrisma.wallet.upsert as jest.Mock).mockResolvedValue({
        address: TEST_ADDRESS,
        verifiedAt: new Date(),
        lastUsedAt: new Date(),
      });

      const linked = await service.verifyChallenge('user-1', challenge.nonce, signature);

      expect(linked.address).toBe(TEST_ADDRESS);
      expect(mockedPrisma.wallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ userId: 'user-1' }),
          create: expect.objectContaining({ chain: 'SOLANA' }),
        }),
      );
    });

    it('rejects a signature from a different keypair than the one challenged', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const otherKeypair = nacl.sign.keyPair();
      const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), otherKeypair.secretKey));

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(UnauthorizedException);
      expect(mockedPrisma.solanaWalletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a syntactically valid but wrong signature (tampered/garbage bytes)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const validSig = sign(challenge.message);
      const tampered = bs58.encode(Buffer.alloc(64, 7));
      expect(tampered).not.toBe(validSig);

      await expect(service.verifyChallenge('user-1', challenge.nonce, tampered)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown nonce', async () => {
      (mockedPrisma.solanaWalletChallenge.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyChallenge('user-1', 'never-issued', 'anything')).rejects.toThrow(BadRequestException);
    });

    it('rejects a nonce issued to a different session (cross-user challenge use)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = sign(challenge.message);

      await expect(service.verifyChallenge('some-other-user', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.solanaWalletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge', async () => {
      let stored: Record<string, unknown> | undefined;
      (mockedPrisma.solanaWalletChallenge.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        stored = { id: 'challenge-1', usedAt: null, ...data };
        return Promise.resolve(stored);
      });
      const challenge = await service.createChallenge('user-1', TEST_ADDRESS);
      stored!.expiresAt = new Date(Date.now() - 1000); // force expiry after issuance
      (mockedPrisma.solanaWalletChallenge.findUnique as jest.Mock).mockImplementation(() => Promise.resolve(stored));
      const signature = sign(challenge.message);

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.solanaWalletChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a nonce that has already been consumed (single-use / replay protection)', async () => {
      const { challenge } = await issuedChallenge('user-1');
      const signature = sign(challenge.message);
      (mockedPrisma.solanaWalletChallenge.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.verifyChallenge('user-1', challenge.nonce, signature)).rejects.toThrow(BadRequestException);
      expect(mockedPrisma.wallet.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listWallets / unlinkWallet', () => {
    it('lists only Solana wallets linked to the caller', async () => {
      (mockedPrisma.wallet.findMany as jest.Mock).mockResolvedValue([
        { address: TEST_ADDRESS, verifiedAt: new Date(), lastUsedAt: new Date() },
      ]);

      const wallets = await service.listWallets('user-1');

      expect(mockedPrisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', chain: 'SOLANA' } }),
      );
      expect(wallets).toHaveLength(1);
    });

    it('unlinks a wallet scoped to (address, caller, SOLANA) so it cannot detach someone else\'s link', async () => {
      (mockedPrisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.unlinkWallet('user-1', TEST_ADDRESS);

      expect(mockedPrisma.wallet.updateMany).toHaveBeenCalledWith({
        where: { address: TEST_ADDRESS, userId: 'user-1', chain: 'SOLANA' },
        data: { userId: null, verifiedAt: null },
      });
    });

    it('404s when the caller has no verified Solana wallet at that address', async () => {
      (mockedPrisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(service.unlinkWallet('user-1', TEST_ADDRESS)).rejects.toThrow('No verified wallet');
    });
  });
});
