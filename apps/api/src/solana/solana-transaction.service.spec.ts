import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, prisma } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { SolanaTransactionService } from './solana-transaction.service';

const mockGetSignatureStatuses = jest.fn();

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation(() => ({
    getSignatureStatuses: mockGetSignatureStatuses,
  })),
}));

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      solanaTradeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      solanaTradeQuote: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const WALLET = 'FakeWalletAddressForTestingOnly1111111111';
const SIGNATURE = 'FakeSignatureForTestingOnly1111111111111111111111111111111111111111111111111';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SOLANA_ENABLED: true,
    SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    SOLANA_TREASURY_USDC_ATA: 'TreasuryUsdcAtaForTestingOnly11111111111',
    SOLANA_JUPITER_PLATFORM_FEE_BPS: 50,
    SOLANA_NEW_WALLET_TOPUP_SOL: 0.01,
    SOLANA_TOPUP_FUNDING_SECRET_KEY: 'fake-secret-key',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quote-1',
    userId: USER_ID,
    walletAddress: WALLET,
    side: 'BUY',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    inputAmount: '10000000',
    expectedOutputAmount: '50000000',
    platformFeeAmount: '50000',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function fakeVerifiedWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return { address: WALLET, userId: USER_ID, verifiedAt: new Date(), chain: 'SOLANA', ...overrides };
}

/** A transaction row — deliberately its own builder, not "spread a quote and override a
 *  couple of fields": a transaction has its own `id`/`userId` distinct from the quote it
 *  was created from, and silently spreading the quote's `id: 'quote-1'` over a
 *  transaction's own `id` would produce a row whose `id` lies about what it is. */
function fakeTransaction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    userId: USER_ID,
    signature: SIGNATURE,
    side: 'BUY',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    inputAmount: '10000000',
    expectedOutputAmount: '50000000',
    platformFeeAmount: '50000',
    status: 'PENDING',
    submittedAt: new Date(),
    confirmedAt: null,
    failureReason: null,
    ...overrides,
  };
}

describe('SolanaTransactionService', () => {
  let service: SolanaTransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SolanaTransactionService(fakeConfig(), fakeLogger());
  });

  describe('submitTransaction', () => {
    it('records a submission even on a deployment with Solana disabled — submission never touches the RPC connection, only status refresh does', async () => {
      const disabledService = new SolanaTransactionService(
        { get: () => undefined } as unknown as ConfigService<Env, true>,
        fakeLogger(),
      );
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet());
      (mockedPrisma.solanaTradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransaction());

      const result = await disabledService.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE });
      expect(result.id).toBe('tx-1');
    });

    it('rejects a status refresh on a deployment with Solana disabled, rather than silently skipping it', async () => {
      const disabledService = new SolanaTransactionService(
        { get: () => undefined } as unknown as ConfigService<Env, true>,
        fakeLogger(),
      );
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction());

      await expect(disabledService.getTransaction(USER_ID, 'tx-1')).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns the existing row when the quote was already submitted (idempotent)', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction());

      const result = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE });

      expect(result.id).toBe('tx-1');
      expect(mockedPrisma.solanaTradeQuote.findUnique).not.toHaveBeenCalled();
    });

    it('rejects submitting a quote that belongs to another user', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s when the quote does not exist', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a wallet mismatch between the quote and the submission', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ walletAddress: 'SomeOtherWallet1111111111111111111111111' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects submitting against an expired quote', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects when the wallet is no longer verified for this account', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a new row for a fresh, valid submission', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet());
      (mockedPrisma.solanaTradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransaction());

      const result = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE });

      expect(result.signature).toBe(SIGNATURE);
      expect(result.status).toBe('PENDING');
    });

    it('treats a duplicate signature (P2002) as an idempotent success, not an error', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // first lookup by quoteId
        .mockResolvedValueOnce(fakeTransaction()); // second lookup by signature after P2002
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet());
      (mockedPrisma.solanaTradeTransaction.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      const result = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', signature: SIGNATURE });
      expect(result.id).toBe('tx-1');
    });
  });

  describe('getTransaction / refreshStatus', () => {
    it('404s for another user', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction({ userId: 'someone-else' }));

      await expect(service.getTransaction(USER_ID, 'tx-1')).rejects.toThrow(NotFoundException);
    });

    it('leaves the row PENDING when the RPC has not seen the signature yet', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction());
      mockGetSignatureStatuses.mockResolvedValue({ value: [null] });

      const result = await service.getTransaction(USER_ID, 'tx-1');

      expect(result.status).toBe('PENDING');
      expect(mockedPrisma.solanaTradeTransaction.update).not.toHaveBeenCalled();
    });

    it('marks FAILED when the on-chain status carries a real error', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction());
      mockGetSignatureStatuses.mockResolvedValue({ value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] });
      (mockedPrisma.solanaTradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeTransaction({ status: 'FAILED', failureReason: 'Transaction failed on-chain' }),
      );

      const result = await service.getTransaction(USER_ID, 'tx-1');

      expect(result.status).toBe('FAILED');
    });

    it('marks CONFIRMED once the RPC reports a confirmed/finalized, error-free status', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransaction());
      mockGetSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
      (mockedPrisma.solanaTradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeTransaction({ status: 'CONFIRMED', confirmedAt: new Date() }),
      );

      const result = await service.getTransaction(USER_ID, 'tx-1');

      expect(result.status).toBe('CONFIRMED');
      expect(result.confirmedAt).not.toBeNull();
    });

    it('does not re-check an already-terminal (CONFIRMED) row against the RPC', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeTransaction({ status: 'CONFIRMED', confirmedAt: new Date() }),
      );

      await service.getTransaction(USER_ID, 'tx-1');

      expect(mockGetSignatureStatuses).not.toHaveBeenCalled();
    });
  });
});
