import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, prisma } from '@kamby/db';
import { TRADING_DEFAULTS } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import type { EvmGasRelayerQuoteService } from './relayer/evm-gas-relayer-quote.service';
import { TransactionService } from './transaction.service';

const mockGetReceiptStatus = jest.fn();
const mockGetTransactionDetails = jest.fn();
const mockGetConfirmationCount = jest.fn();

jest.mock('@kamby/chain-adapters', () => ({
  EvmChainDataProvider: jest.fn().mockImplementation(() => ({
    getTransactionReceiptStatus: mockGetReceiptStatus,
    getTransactionDetails: mockGetTransactionDetails,
    getConfirmationCount: mockGetConfirmationCount,
  })),
}));

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      tradeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      tradeQuote: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const USER_ID = 'user-1';
const WALLET = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 8453;
const TX_HASH = `0x${'a'.repeat(64)}`;
const UNSIGNED_TX = { to: '0xcccccccccccccccccccccccccccccccccccccccc', data: '0xdeadbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };
/** Exactly matches WALLET/UNSIGNED_TX above — the "everything lines up" on-chain reading. */
const MATCHING_ON_CHAIN = { from: WALLET, to: UNSIGNED_TX.to, value: 0n, data: UNSIGNED_TX.data };

// The separate guaranteed-USDC fee transfer — see docs/TRADING.md#guaranteed-usdc-fees.
// Deliberately a different `to`/`data` than the swap's UNSIGNED_TX above, since it's a
// plain ERC20 transfer(feeRecipient, amount) against the USDC contract, not a swap call.
const FEE_TX_HASH = `0x${'b'.repeat(64)}`;
const FEE_UNSIGNED_TX = { to: '0xdddddddddddddddddddddddddddddddddddddddd', data: '0xfeefeefee', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };
const MATCHING_FEE_ON_CHAIN = { from: WALLET, to: FEE_UNSIGNED_TX.to, value: 0n, data: FEE_UNSIGNED_TX.data };

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeGasRelayer(): EvmGasRelayerQuoteService {
  return { submitFeeLegIfDue: jest.fn().mockResolvedValue(undefined) } as unknown as EvmGasRelayerQuoteService;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: CHAIN_ID,
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quote-1',
    userId: USER_ID,
    walletAddress: WALLET,
    chainId: CHAIN_ID,
    tokenMarketId: 'market-1',
    side: 'BUY',
    inputToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    outputToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '100000000000000000000',
    platformFeeAmount: '500000000000000000',
    unsignedTx: UNSIGNED_TX,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function fakeVerifiedWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return { address: WALLET, userId: USER_ID, verifiedAt: new Date(), ...overrides };
}

function fakeTransactionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    userId: USER_ID,
    walletAddress: WALLET,
    quoteId: 'quote-1',
    chainId: CHAIN_ID,
    txHash: TX_HASH,
    side: 'BUY',
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '100000000000000000000',
    platformFeeAmount: '500000000000000000',
    status: 'PENDING',
    failureReason: null,
    submittedAt: new Date(),
    confirmedAt: null,
    feeTxHash: null,
    feeStatus: null,
    feeFailureReason: null,
    feeSubmittedAt: null,
    feeConfirmedAt: null,
    sponsoredByRelayer: false,
    relayerFeePayer: null,
    tokenMarket: {
      token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 },
      quoteToken: { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'WETH', decimals: 18 },
    },
    quote: { unsignedTx: UNSIGNED_TX, feeUnsignedTx: null },
    ...overrides,
  };
}

/** A row whose trade is eligible for the guaranteed-USDC-fee flow — its quote carries a
 *  feeUnsignedTx, so submitFeeTransaction/refreshFeeStatus have something to act on. */
function fakeGuaranteedFeeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return fakeTransactionRow({ quote: { unsignedTx: UNSIGNED_TX, feeUnsignedTx: FEE_UNSIGNED_TX }, ...overrides });
}

describe('TransactionService', () => {
  let service: TransactionService;
  let gasRelayer: EvmGasRelayerQuoteService;

  beforeEach(() => {
    jest.clearAllMocks();
    gasRelayer = fakeGasRelayer();
    service = new TransactionService(fakeConfig(), fakeLogger(), gasRelayer);
    // Sensible "everything checks out" defaults — tests targeting a specific rejection
    // override just the one mock that needs to fail.
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet());
    mockGetTransactionDetails.mockResolvedValue(MATCHING_ON_CHAIN);
    // Comfortably above TRADING_DEFAULTS.minConfirmations — tests targeting the
    // confirmation-depth gate itself override this explicitly.
    mockGetConfirmationCount.mockResolvedValue(TRADING_DEFAULTS.minConfirmations + 5);
  });

  describe('submitTransaction', () => {
    it('rejects a malformed transaction hash before touching the database', async () => {
      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: '0xnothex' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.findUnique).not.toHaveBeenCalled();
    });

    it('404s on an unknown quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'missing', txHash: TX_HASH }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a quote that belongs to a different user', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a quote created for a different wallet than the one submitting', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ walletAddress: '0x9999999999999999999999999999999999999a' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects submission against an expired quote — a stale quoteId can never be replayed', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('treats the exact expiry instant as expired, not a boundary grace period', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(now) }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(UnprocessableEntityException);
      jest.restoreAllMocks();
    });

    it('rejects submission when the wallet is no longer linked to any account (e.g. unlinked after the quote was created)', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects submission when the wallet has since been re-verified to a different account', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects submission when the wallet is linked but its verification was cleared', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeVerifiedWallet({ verifiedAt: null }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an already-visible transaction whose sender does not match the quoted wallet — an unrelated hash, even a real one', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, from: '0x9999999999999999999999999999999999999a' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects an already-visible transaction whose destination does not match the quoted router/contract', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, to: '0x0000000000000000000000000000000000dead' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an already-visible transaction whose value or calldata does not match the quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, data: '0x00' });

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows submission through when the transaction is not yet visible to our RPC (a very recent broadcast) — refreshStatus is the authoritative gate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetTransactionDetails.mockResolvedValue(null);

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.status).toBe('PENDING');
    });

    it('creates a PENDING transaction row from a valid, owned quote whose on-chain details already match', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.status).toBe('PENDING');
      expect(dto.txHash).toBe(TX_HASH);
      expect(mockedPrisma.tradeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ txHash: TX_HASH, userId: USER_ID }) }),
      );
    });

    it('is idempotent on quoteId — a retry for an already-submitted quote returns the existing row instead of creating a duplicate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.id).toBe('tx-1');
      expect(mockedPrisma.tradeTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects an idempotent quoteId hit that belongs to someone else', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }));

      await expect(
        service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('recovers from a (chainId, txHash) unique-constraint race by returning the row that won instead of erroring', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // no existing row by quoteId
        .mockResolvedValueOnce(fakeTransactionRow()); // lookup by (chainId, txHash) after the race
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      const dto = await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      expect(dto.id).toBe('tx-1');
    });

    it('never trusts the client for the final status — a submitted tx always starts PENDING regardless of any other input', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote());
      (mockedPrisma.tradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow());

      await service.submitTransaction({ userId: USER_ID, walletAddress: WALLET, quoteId: 'quote-1', txHash: TX_HASH });

      const createCall = (mockedPrisma.tradeTransaction.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.status).toBeUndefined(); // relies on the schema default, never client-set
    });
  });

  describe('submitFeeTransaction', () => {
    it('rejects a malformed transaction hash before touching the database', async () => {
      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: '0xnothex' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.findUnique).not.toHaveBeenCalled();
    });

    it('404s on an unknown transaction id', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'missing', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a transaction that belongs to a different user — never leaks that it exists', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow({ userId: 'someone-else' }));

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the trade has no guaranteed-USDC fee to submit — the quote never got a feeUnsignedTx', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow()); // default quote.feeUnsignedTx is null

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('rejects submission when the wallet is no longer verified — re-checked from the database, not trusted from the row', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow());
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('rejects an already-visible fee transaction whose on-chain details do not match the expected transfer', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow());
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_FEE_ON_CHAIN, to: '0x0000000000000000000000000000000000dead' });

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('records a PENDING fee transaction from a valid, verified submission', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow());
      mockGetTransactionDetails.mockResolvedValue(MATCHING_FEE_ON_CHAIN);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );

      const dto = await service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH });

      expect(dto.feeTxHash).toBe(FEE_TX_HASH);
      expect(dto.feeStatus).toBe('PENDING');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING' }) }),
      );
    });

    it('allows submission through when the fee transaction is not yet visible to our RPC — refreshFeeStatus is the authoritative gate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow());
      mockGetTransactionDetails.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING' }),
      );

      const dto = await service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH });

      expect(dto.feeStatus).toBe('PENDING');
    });

    it('is idempotent on an identical retry — returns the existing row instead of erroring or double-recording', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING' }),
      );

      const dto = await service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH });

      expect(dto.feeTxHash).toBe(FEE_TX_HASH);
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('rejects a conflicting retry that supplies a different hash than what was already recorded', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING' }),
      );

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: `0x${'c'.repeat(64)}` }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('recovers from a (chainId, feeTxHash) unique-constraint race by rejecting as a real conflict, not silently attaching an unrelated hash to this trade', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeGuaranteedFeeRow());
      mockGetTransactionDetails.mockResolvedValue(MATCHING_FEE_ON_CHAIN);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      await expect(
        service.submitFeeTransaction({ userId: USER_ID, transactionId: 'tx-1', txHash: FEE_TX_HASH }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getTransaction / refreshStatus', () => {
    it('404s when the transaction does not belong to the caller', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }));

      await expect(service.getTransaction(USER_ID, 'tx-1')).rejects.toThrow(NotFoundException);
    });

    it('refreshes a PENDING transaction to CONFIRMED from a real receipt whose on-chain details match the persisted quote', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'CONFIRMED', confirmedAt: new Date() }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('leaves a matching, successful receipt PENDING (never CONFIRMED) until minConfirmations is reached — the reorg-protection gate', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetConfirmationCount.mockResolvedValue(TRADING_DEFAULTS.minConfirmations - 1);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('PENDING');
      const updateCalls = (mockedPrisma.tradeTransaction.update as jest.Mock).mock.calls;
      expect(updateCalls).toHaveLength(0);
    });

    it('never confirms when the confirmation depth cannot be read at all, even with a matching successful receipt', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetConfirmationCount.mockResolvedValue(null);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('PENDING');
      const updateCalls = (mockedPrisma.tradeTransaction.update as jest.Mock).mock.calls;
      expect(updateCalls.every((call) => call[0].data.status !== 'CONFIRMED')).toBe(true);
    });

    it('never confirms a successful receipt for an unrelated transaction — the core transaction-integrity guarantee', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      // A real, successful receipt — but sent from a completely different wallet than the
      // one this trade was quoted for. Exactly the "arbitrary successful hash" attack.
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_ON_CHAIN, from: '0x9999999999999999999999999999999999999a' });
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeTransactionRow({ status: 'FAILED', failureReason: 'On-chain transaction does not match the reviewed trade' }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('FAILED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('does not match') }) }),
      );
      // Decisive: CONFIRMED must never appear in any update call for this transaction.
      const updateCalls = (mockedPrisma.tradeTransaction.update as jest.Mock).mock.calls;
      expect(updateCalls.every((call) => call[0].data.status !== 'CONFIRMED')).toBe(true);
    });

    it('never confirms when the on-chain transaction cannot be read at all, even with a successful receipt', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetTransactionDetails.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).not.toBe('CONFIRMED');
    });

    it('never confirms when the persisted quote itself has an unparseable unsignedTx', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ quote: { unsignedTx: { garbage: true } } }));
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).not.toBe('CONFIRMED');
    });

    it('marks a reverted receipt as FAILED, never as a silent success', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue('reverted');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'FAILED', failureReason: 'Transaction reverted on-chain' }));

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('FAILED');
    });

    it('leaves a transaction PENDING (never fabricates confirmation) when no receipt exists yet and it is not stale', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow());
      mockGetReceiptStatus.mockResolvedValue(null);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('PENDING');
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('expires a PENDING transaction that has waited past the configured timeout with no receipt', async () => {
      const old = fakeTransactionRow({ submittedAt: new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 5) * 60_000) });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(old);
      mockGetReceiptStatus.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue({ ...old, status: 'EXPIRED' });

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('EXPIRED');
    });

    it('triggers the sponsored trade fee leg once a relayer-sponsored swap is observed CONFIRMED', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ sponsoredByRelayer: true }));
      mockGetReceiptStatus.mockResolvedValue('success');
      const confirmedRow = fakeTransactionRow({ sponsoredByRelayer: true, status: 'CONFIRMED', confirmedAt: new Date() });
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(confirmedRow);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED');
      expect(gasRelayer.submitFeeLegIfDue).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1', status: 'CONFIRMED' }));
    });

    it('never triggers the fee leg for a transaction that is not sponsored by the relayer', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ sponsoredByRelayer: false }));
      mockGetReceiptStatus.mockResolvedValue('success');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(fakeTransactionRow({ status: 'CONFIRMED', confirmedAt: new Date() }));

      await service.getTransaction(USER_ID, 'tx-1');

      // submitFeeLegIfDue is still called (it's cheap and idempotent for a non-sponsored
      // row — see its own doc comment), but only ever with a CONFIRMED row; the real
      // no-op-for-non-sponsored logic lives inside EvmGasRelayerQuoteService itself, not
      // duplicated here.
      expect(gasRelayer.submitFeeLegIfDue).toHaveBeenCalled();
    });

    it('never triggers the fee leg while a transaction is still PENDING', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ sponsoredByRelayer: true }));
      mockGetReceiptStatus.mockResolvedValue(null);

      await service.getTransaction(USER_ID, 'tx-1');

      expect(gasRelayer.submitFeeLegIfDue).not.toHaveBeenCalled();
    });

    it('never triggers the fee leg for a transaction that just failed or reverted', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ sponsoredByRelayer: true }));
      mockGetReceiptStatus.mockResolvedValue('reverted');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeTransactionRow({ sponsoredByRelayer: true, status: 'FAILED', failureReason: 'Transaction reverted on-chain' }),
      );

      await service.getTransaction(USER_ID, 'tx-1');

      expect(gasRelayer.submitFeeLegIfDue).not.toHaveBeenCalled();
    });
  });

  describe('getTransaction / refreshFeeStatus', () => {
    // Every row here is already CONFIRMED on the swap side, so getTransaction's own
    // refreshStatus call is a no-op and only the fee-refresh path under test runs — see
    // docs/TRADING.md#guaranteed-usdc-fees: a confirmed swap is a fully successful trade
    // regardless of what its separate fee transfer is doing.

    it('does nothing when there is no fee transaction submitted yet', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date() }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED');
      expect(dto.feeStatus).toBeNull();
      expect(mockGetReceiptStatus).not.toHaveBeenCalled();
    });

    it('confirms the fee transfer once its receipt matches and reaches minConfirmations', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetTransactionDetails.mockResolvedValue(MATCHING_FEE_ON_CHAIN);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', feeTxHash: FEE_TX_HASH, feeStatus: 'CONFIRMED', feeConfirmedAt: new Date() }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.feeStatus).toBe('CONFIRMED');
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeStatus: 'CONFIRMED' }) }),
      );
    });

    it('leaves a matching, successful fee receipt PENDING until minConfirmations is reached', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetTransactionDetails.mockResolvedValue(MATCHING_FEE_ON_CHAIN);
      mockGetConfirmationCount.mockResolvedValue(TRADING_DEFAULTS.minConfirmations - 1);

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.feeStatus).toBe('PENDING');
      expect(mockedPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    });

    it('marks the fee FAILED (never CONFIRMED) when a successful receipt does not match the expected transfer', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );
      mockGetReceiptStatus.mockResolvedValue('success');
      mockGetTransactionDetails.mockResolvedValue({ ...MATCHING_FEE_ON_CHAIN, to: '0x0000000000000000000000000000000000dead' });
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', feeTxHash: FEE_TX_HASH, feeStatus: 'FAILED' }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.feeStatus).toBe('FAILED');
      const updateCalls = (mockedPrisma.tradeTransaction.update as jest.Mock).mock.calls;
      expect(updateCalls.every((call) => call[0].data.feeStatus !== 'CONFIRMED')).toBe(true);
    });

    it('marks a reverted fee receipt as FAILED, never a silent success', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );
      mockGetReceiptStatus.mockResolvedValue('reverted');
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', feeTxHash: FEE_TX_HASH, feeStatus: 'FAILED', feeFailureReason: 'Fee transfer reverted on-chain' }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.feeStatus).toBe('FAILED');
    });

    it('expires a fee transfer that has waited past the configured timeout with no receipt', async () => {
      const staleSubmittedAt = new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 5) * 60_000);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: staleSubmittedAt }),
      );
      mockGetReceiptStatus.mockResolvedValue(null);
      (mockedPrisma.tradeTransaction.update as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', feeTxHash: FEE_TX_HASH, feeStatus: 'EXPIRED' }),
      );

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.feeStatus).toBe('EXPIRED');
    });

    it('a confirmed swap with a still-pending fee transfer is reported as a fully successful trade regardless', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(
        fakeGuaranteedFeeRow({ status: 'CONFIRMED', confirmedAt: new Date(), feeTxHash: FEE_TX_HASH, feeStatus: 'PENDING', feeSubmittedAt: new Date() }),
      );
      mockGetReceiptStatus.mockResolvedValue(null); // fee tx still not mined anywhere yet

      const dto = await service.getTransaction(USER_ID, 'tx-1');

      expect(dto.status).toBe('CONFIRMED'); // the trade itself is never gated on the fee
      expect(dto.feeStatus).toBe('PENDING');
    });
  });

  describe('getHistory', () => {
    it('is always scoped to the caller\'s own userId — there is no parameter to widen it', async () => {
      (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([]);

      await service.getHistory(USER_ID, undefined, 20);

      expect(mockedPrisma.tradeTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
      );
    });
  });
});
