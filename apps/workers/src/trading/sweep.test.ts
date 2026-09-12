import { TRADING_DEFAULTS } from '@kamby/domain';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeSweepService } from './sweep';

const mockPrisma = vi.hoisted(() => ({
  tradeTransaction: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const CHAIN_ID = 8453;
const WALLET = '0x1234567890123456789012345678901234567890';
const UNSIGNED_TX = { to: '0xdead000000000000000000000000000000dead', data: '0xbeef', value: '1000', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };

/** Matches WALLET/UNSIGNED_TX by default, so tests that don't care about the on-chain
 *  match check don't have to think about it — override `onChainDetails` to test mismatch. */
function fakeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    txHash: `0x${'a'.repeat(64)}`,
    submittedAt: new Date(),
    walletAddress: WALLET,
    quote: { unsignedTx: UNSIGNED_TX },
    ...overrides,
  };
}

const MATCHING_ON_CHAIN = { from: WALLET, to: UNSIGNED_TX.to, value: 1000n, data: UNSIGNED_TX.data };

// See docs/TRADING.md#guaranteed-usdc-fees — the separate fee-transfer leg.
const FEE_UNSIGNED_TX = { to: '0xfee0000000000000000000000000000000fee0', data: '0xf00d', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };
const MATCHING_FEE_ON_CHAIN = { from: WALLET, to: FEE_UNSIGNED_TX.to, value: 0n, data: FEE_UNSIGNED_TX.data };

function fakeFeeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    feeTxHash: `0x${'b'.repeat(64)}`,
    feeSubmittedAt: new Date(),
    walletAddress: WALLET,
    quote: { feeUnsignedTx: FEE_UNSIGNED_TX },
    ...overrides,
  };
}

describe('TradeSweepService', () => {
  let getTransactionReceiptStatus: ReturnType<typeof vi.fn>;
  let getTransactionDetails: ReturnType<typeof vi.fn>;
  let getConfirmationCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getTransactionReceiptStatus = vi.fn();
    getTransactionDetails = vi.fn().mockResolvedValue(MATCHING_ON_CHAIN);
    // Comfortably above TRADING_DEFAULTS.minConfirmations — tests targeting the
    // confirmation-depth gate itself override this explicitly.
    getConfirmationCount = vi.fn().mockResolvedValue(TRADING_DEFAULTS.minConfirmations + 5);
  });

  function buildService() {
    const chainReader = {
      getTransactionReceiptStatus,
      getTransactionDetails,
      getConfirmationCount,
    } as unknown as ConstructorParameters<typeof TradeSweepService>[1];
    return new TradeSweepService(CHAIN_ID, chainReader, fakeLogger);
  }

  it('only ever looks at PENDING transactions on the configured chain', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([]);
    const service = buildService();

    await service.sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING', chainId: CHAIN_ID } }),
    );
  });

  it('marks a transaction CONFIRMED from a real success receipt whose on-chain details match the quote', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tx-1' }, data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, expired: 0 });
  });

  it('leaves a matching, successful receipt PENDING (never CONFIRMED or FAILED) until minConfirmations is reached — the reorg-protection gate', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');
    getConfirmationCount.mockResolvedValue(TRADING_DEFAULTS.minConfirmations - 1);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, expired: 0 });
  });

  it('never confirms when the confirmation depth cannot be read at all, even with a matching successful receipt', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');
    getConfirmationCount.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    expect(result.confirmed).toBe(0);
  });

  it('never confirms a successful receipt whose on-chain sender/destination/value/calldata do not match the persisted quote — marks it FAILED instead', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');
    getTransactionDetails.mockResolvedValue({ from: '0x9999999999999999999999999999999999999a', to: UNSIGNED_TX.to, value: 1000n, data: UNSIGNED_TX.data });

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('does not match') }),
      }),
    );
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 1, expired: 0 });
  });

  it('never confirms when the on-chain transaction cannot be read at all, even with a successful receipt', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('success');
    getTransactionDetails.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(result.confirmed).toBe(0);
  });

  it('marks a transaction FAILED from a real reverted receipt, never a silent success', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue('reverted');

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(result.failed).toBe(1);
  });

  it('leaves a fresh, receipt-less transaction PENDING — never fabricates a status', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow()]);
    getTransactionReceiptStatus.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, expired: 0 });
  });

  it('expires a receipt-less transaction once it has waited past the configured timeout', async () => {
    const old = fakeRow({ submittedAt: new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 1) * 60_000) });
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([old]);
    getTransactionReceiptStatus.mockResolvedValue(null);

    const result = await buildService().sweepPendingTransactions();

    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
    );
    expect(result.expired).toBe(1);
  });

  it('continues past a single row that errors, so one RPC hiccup does not abort the whole batch', async () => {
    mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeRow({ id: 'tx-bad' }), fakeRow({ id: 'tx-good' })]);
    getTransactionReceiptStatus.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce('success');

    const result = await buildService().sweepPendingTransactions();

    expect(result.checked).toBe(2);
    expect(result.confirmed).toBe(1);
    expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledTimes(1);
  });

  describe('sweepPendingFeeTransactions', () => {
    beforeEach(() => {
      getTransactionDetails.mockResolvedValue(MATCHING_FEE_ON_CHAIN);
    });

    it('only ever looks at rows with a PENDING fee status on the configured chain — independent of the swap status', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([]);
      const service = buildService();

      await service.sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { feeStatus: 'PENDING', chainId: CHAIN_ID } }),
      );
    });

    it('marks a fee transfer CONFIRMED from a real success receipt whose on-chain details match the expected transfer', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow()]);
      getTransactionReceiptStatus.mockResolvedValue('success');

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tx-1' }, data: expect.objectContaining({ feeStatus: 'CONFIRMED' }) }),
      );
      expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, expired: 0 });
    });

    it('leaves a matching, successful fee receipt PENDING until minConfirmations is reached', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow()]);
      getTransactionReceiptStatus.mockResolvedValue('success');
      getConfirmationCount.mockResolvedValue(TRADING_DEFAULTS.minConfirmations - 1);

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
      expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, expired: 0 });
    });

    it('never confirms a successful fee receipt whose on-chain details do not match the expected transfer — marks it FAILED instead', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow()]);
      getTransactionReceiptStatus.mockResolvedValue('success');
      getTransactionDetails.mockResolvedValue({ ...MATCHING_FEE_ON_CHAIN, from: '0x9999999999999999999999999999999999999a' });

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeStatus: 'FAILED', feeFailureReason: expect.stringContaining('does not match') }) }),
      );
      expect(result).toEqual({ checked: 1, confirmed: 0, failed: 1, expired: 0 });
    });

    it('marks a fee transfer FAILED from a real reverted receipt, never a silent success', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow()]);
      getTransactionReceiptStatus.mockResolvedValue('reverted');

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeStatus: 'FAILED', feeFailureReason: 'Fee transfer reverted on-chain' }) }),
      );
      expect(result.failed).toBe(1);
    });

    it('leaves a fresh, receipt-less fee transfer PENDING — never fabricates a status', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow()]);
      getTransactionReceiptStatus.mockResolvedValue(null);

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).not.toHaveBeenCalled();
      expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, expired: 0 });
    });

    it('expires a receipt-less fee transfer once it has waited past the configured timeout', async () => {
      const old = fakeFeeRow({ feeSubmittedAt: new Date(Date.now() - (TRADING_DEFAULTS.pendingTransactionTimeoutMinutes + 1) * 60_000) });
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([old]);
      getTransactionReceiptStatus.mockResolvedValue(null);

      const result = await buildService().sweepPendingFeeTransactions();

      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeStatus: 'EXPIRED' }) }),
      );
      expect(result.expired).toBe(1);
    });

    it('continues past a single row that errors, so one RPC hiccup does not abort the whole batch', async () => {
      mockPrisma.tradeTransaction.findMany.mockResolvedValue([fakeFeeRow({ id: 'tx-bad' }), fakeFeeRow({ id: 'tx-good' })]);
      getTransactionReceiptStatus.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce('success');

      const result = await buildService().sweepPendingFeeTransactions();

      expect(result.checked).toBe(2);
      expect(result.confirmed).toBe(1);
      expect(mockPrisma.tradeTransaction.update).toHaveBeenCalledTimes(1);
    });
  });
});
