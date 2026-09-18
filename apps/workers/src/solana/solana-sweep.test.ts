import { TRADING_DEFAULTS } from '@kamby/domain';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SolanaSweepService } from './solana-sweep';

const mockPrisma = vi.hoisted(() => ({
  solanaTradeTransaction: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const SIGNATURE = 'FakeSignatureForTestingOnly1111111111111111111111111111111111111111111111111';

function fakeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    signature: SIGNATURE,
    submittedAt: new Date(),
    ...overrides,
  };
}

describe('SolanaSweepService', () => {
  let getSignatureStatuses: ReturnType<typeof vi.fn>;
  let fallbackGetSignatureStatuses: ReturnType<typeof vi.fn>;
  let redis: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    getSignatureStatuses = vi.fn();
    fallbackGetSignatureStatuses = vi.fn();
    redis = { publish: vi.fn().mockResolvedValue(1) };
  });

  function buildService(withFallback = false) {
    const connection = { getSignatureStatuses } as unknown as ConstructorParameters<typeof SolanaSweepService>[0];
    const fallbackConnection = withFallback
      ? ({ getSignatureStatuses: fallbackGetSignatureStatuses } as unknown as ConstructorParameters<typeof SolanaSweepService>[1])
      : null;
    return new SolanaSweepService(connection, fallbackConnection, redis as unknown as ConstructorParameters<typeof SolanaSweepService>[2], fakeLogger);
  }

  it('only ever looks at PENDING Solana transactions', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([]);
    const service = buildService();

    await service.sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING' } }),
    );
  });

  it('marks CONFIRMED once the RPC reports a confirmed/finalized, error-free status, and publishes a realtime ping', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'CONFIRMED', confirmedAt: expect.any(Date) },
    });
    expect(redis.publish).toHaveBeenCalledWith('kamby:solana-activity:new', expect.stringContaining('tx-1'));
    expect(result.confirmed).toBe(1);
  });

  it('marks FAILED when the on-chain status carries a real error, and never publishes for it', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getSignatureStatuses.mockResolvedValue({ value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'FAILED', failureReason: 'Transaction failed on-chain' },
    });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('leaves a transaction PENDING when the RPC has not seen the signature yet and it is not stale', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow({ submittedAt: new Date() })]);
    getSignatureStatuses.mockResolvedValue({ value: [null] });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.update).not.toHaveBeenCalled();
    expect(result.checked).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.expired).toBe(0);
  });

  it('marks EXPIRED once a signature the RPC has never seen sits past the timeout — the backstop the on-demand refresh never does', async () => {
    const staleSubmittedAt = new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 1) * 60_000);
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow({ submittedAt: staleSubmittedAt })]);
    getSignatureStatuses.mockResolvedValue({ value: [null] });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'EXPIRED', failureReason: 'No confirmation received within the expected time' },
    });
    expect(result.expired).toBe(1);
  });

  it('leaves a transaction PENDING when it has landed but not yet reached confirmed/finalized', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'processed' }] });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.solanaTradeTransaction.update).not.toHaveBeenCalled();
    expect(result.confirmed).toBe(0);
  });

  it('falls over to the fallback RPC when the primary fails', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getSignatureStatuses.mockRejectedValue(new Error('primary RPC unreachable'));
    fallbackGetSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });

    const result = await buildService(true).sweepPendingTransactions();

    expect(fallbackGetSignatureStatuses).toHaveBeenCalledWith([SIGNATURE]);
    expect(result.confirmed).toBe(1);
  });

  it('one bad row never aborts the rest of the batch', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow({ id: 'tx-1' }), fakeRow({ id: 'tx-2' })]);
    getSignatureStatuses
      .mockRejectedValueOnce(new Error('RPC hiccup'))
      .mockResolvedValueOnce({ value: [{ err: null, confirmationStatus: 'confirmed' }] });

    const result = await buildService().sweepPendingTransactions();

    expect(result.checked).toBe(2);
    expect(result.confirmed).toBe(1);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it('never fails the sweep tick itself when the realtime publish fails', async () => {
    mockPrisma.solanaTradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    redis.publish.mockRejectedValue(new Error('redis down'));

    const result = await buildService().sweepPendingTransactions();

    expect(result.confirmed).toBe(1);
  });
});
