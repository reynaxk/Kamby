import { SOLANA_USDC_MINT } from '@kamby/domain';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PnlLedgerSweepService } from './pnl-ledger-sweep';

const mockPrisma = vi.hoisted(() => ({
  tradeTransaction: { findMany: vi.fn(), update: vi.fn() },
  solanaTradeTransaction: { findMany: vi.fn(), update: vi.fn() },
  tokenLot: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  realizedPnlEvent: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const USER_ID = 'user-1';
const TOKEN_ID = 'token-1';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function evmRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evm-tx-1',
    userId: USER_ID,
    side: 'BUY',
    inputAmount: '100000000', // 100 USDC (6 decimals)
    expectedOutputAmount: '2000000000000000000', // 2 tokens (18 decimals)
    confirmedAt: NOW,
    quote: { priceUsd: '50' }, // $50/token
    tokenMarket: { tokenId: TOKEN_ID, token: { decimals: 18 } },
    ...overrides,
  };
}

function solanaRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sol-tx-1',
    userId: USER_ID,
    side: 'BUY',
    inputMint: SOLANA_USDC_MINT,
    outputMint: 'TargetMint111111111111111111111111111111',
    inputAmount: '10000000', // 10 USDC
    expectedOutputAmount: '5000000000', // 5 tokens (9 decimals, e.g. a typical SPL token)
    confirmedAt: NOW,
    ...overrides,
  };
}

describe('PnlLedgerSweepService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([]);
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([]);
    mockPrisma.tokenLot.findMany.mockResolvedValue([]);
    // $transaction just runs the callback against the same mock object, standing in for
    // a real transaction client — every test asserts on mockPrisma.<model> calls
    // regardless of whether the real code called them via `tx` or the outer `prisma`.
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
  });

  function buildService() {
    return new PnlLedgerSweepService(fakeLogger);
  }

  describe('EVM BUY', () => {
    it('creates a TokenLot priced off the acquired quantity times the quote priceUsd', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([evmRow()]);
      const service = buildService();

      const result = await service.sweep();

      expect(mockPrisma.tokenLot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          chain: 'EVM',
          evmTokenId: TOKEN_ID,
          evmBuyTransactionId: 'evm-tx-1',
          quantityOriginalRaw: '2000000000000000000',
          quantityRemainingRaw: '2000000000000000000',
          costBasisUsd: 100, // 2 tokens * $50
        }),
      });
      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'evm-tx-1' },
        data: { pnlProcessedAt: expect.any(Date) },
      });
      expect(result).toEqual({ checked: 1, lotsCreated: 1, eventsCreated: 0, skippedNoPrice: 0 });
    });

    it('skips and marks processed (never fabricates a cost basis) when the quote has no priceUsd', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([evmRow({ quote: { priceUsd: null } })]);
      const service = buildService();

      const result = await service.sweep();

      expect(mockPrisma.tokenLot.create).not.toHaveBeenCalled();
      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'evm-tx-1' },
        data: { pnlProcessedAt: expect.any(Date) },
      });
      expect(result.skippedNoPrice).toBe(1);
    });

    it('skips and marks processed when the token\'s decimals are not known yet', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([
        evmRow({ tokenMarket: { tokenId: TOKEN_ID, token: { decimals: null } } }),
      ]);
      const service = buildService();

      const result = await service.sweep();

      expect(mockPrisma.tokenLot.create).not.toHaveBeenCalled();
      expect(result.skippedNoPrice).toBe(1);
    });
  });

  describe('EVM SELL', () => {
    it('FIFO-matches against open lots and records a RealizedPnlEvent', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([
        evmRow({ id: 'evm-tx-2', side: 'SELL', inputAmount: '1000000000000000000' /* 1 token sold */ }),
      ]);
      mockPrisma.tokenLot.findMany.mockResolvedValue([
        { id: 'lot-1', quantityOriginalRaw: '2000000000000000000', quantityRemainingRaw: '2000000000000000000', costBasisUsd: 80 },
      ]);
      const service = buildService();

      const result = await service.sweep();

      // Sold 1 of 2 tokens from a lot that cost $80 total ($40/token) — quote.priceUsd
      // ($50) prices the proceeds: 1 token * $50 = $50 proceeds, $40 matched cost basis.
      expect(mockPrisma.realizedPnlEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          lotId: 'lot-1',
          quantityMatchedRaw: '1000000000000000000',
          costBasisUsd: 40,
          proceedsUsd: 50,
          realizedPnlUsd: 10,
          evmSellTransactionId: 'evm-tx-2',
        }),
      });
      expect(mockPrisma.tokenLot.update).toHaveBeenCalledWith({
        where: { id: 'lot-1' },
        data: { quantityRemainingRaw: '1000000000000000000' },
      });
      expect(result.eventsCreated).toBe(1);
    });

    it('never records an event for the unmatched portion of a sell that exceeds all open lots', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([
        evmRow({ id: 'evm-tx-3', side: 'SELL', inputAmount: '3000000000000000000' /* 3 tokens sold */ }),
      ]);
      mockPrisma.tokenLot.findMany.mockResolvedValue([
        { id: 'lot-1', quantityOriginalRaw: '1000000000000000000', quantityRemainingRaw: '1000000000000000000', costBasisUsd: 30 },
      ]);
      const service = buildService();

      await service.sweep();

      expect(mockPrisma.realizedPnlEvent.create).toHaveBeenCalledTimes(1); // only the matched 1 token, never the unmatched 2
    });
  });

  describe('Solana', () => {
    it('creates a lot from the USDC-anchored BUY leg with no price lookup needed', async () => {
      mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([solanaRow()]);
      const service = buildService();

      const result = await service.sweep();

      expect(mockPrisma.tokenLot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          chain: 'SOLANA',
          solanaMint: 'TargetMint111111111111111111111111111111',
          solanaBuyTransactionId: 'sol-tx-1',
          costBasisUsd: 10, // 10 USDC spent, 6 decimals
        }),
      });
      expect(result.lotsCreated).toBe(1);
    });

    it('matches a Solana SELL against its own open lots, pricing proceeds off the USDC leg', async () => {
      mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([
        solanaRow({
          id: 'sol-tx-2',
          side: 'SELL',
          inputMint: 'TargetMint111111111111111111111111111111',
          outputMint: SOLANA_USDC_MINT,
          inputAmount: '5000000000', // sell all 5 tokens
          expectedOutputAmount: '12000000', // receive 12 USDC
        }),
      ]);
      mockPrisma.tokenLot.findMany.mockResolvedValue([
        { id: 'lot-1', quantityOriginalRaw: '5000000000', quantityRemainingRaw: '5000000000', costBasisUsd: 10 },
      ]);
      const service = buildService();

      await service.sweep();

      expect(mockPrisma.realizedPnlEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ costBasisUsd: 10, proceedsUsd: 12, realizedPnlUsd: 2, solanaSellTransactionId: 'sol-tx-2' }),
      });
    });

    it('never guesses when neither leg is USDC — the anchor invariant this sweep depends on', async () => {
      mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([
        solanaRow({ inputMint: 'NotUsdc1111111111111111111111111111111111', outputMint: 'AlsoNotUsdc11111111111111111111111111111' }),
      ]);
      const service = buildService();

      const result = await service.sweep();

      expect(mockPrisma.tokenLot.create).not.toHaveBeenCalled();
      expect(mockPrisma.solanaTradeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'sol-tx-1' },
        data: { pnlProcessedAt: expect.any(Date) },
      });
      expect(result.checked).toBe(1);
    });
  });

  it('one bad row never aborts the rest of the batch', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([evmRow({ id: 'evm-bad' }), evmRow({ id: 'evm-good' })]);
    mockPrisma.tokenLot.create.mockRejectedValueOnce(new Error('DB hiccup')).mockResolvedValue(undefined);
    const service = buildService();

    const result = await service.sweep();

    expect(result.checked).toBe(2);
    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'evm-bad' }),
      expect.stringContaining('failed to process'),
    );
  });
});
