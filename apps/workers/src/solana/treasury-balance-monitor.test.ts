import { Keypair } from '@solana/web3.js';
import type { Connection, PublicKey } from '@solana/web3.js';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTreasuryBalances } from './treasury-balance-monitor';

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const WALLET_A = Keypair.generate().publicKey.toBase58();
const WALLET_B = Keypair.generate().publicKey.toBase58();

describe('checkTreasuryBalances', () => {
  let getBalance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getBalance = vi.fn();
  });

  function connection(): Connection {
    return { getBalance } as unknown as Connection;
  }

  it('logs info (not warn) and reports belowThreshold: false when a balance is comfortably above its threshold', async () => {
    getBalance.mockResolvedValue(200_000_000);

    const results = await checkTreasuryBalances(connection(), [{ label: 'wallet-a', publicKey: WALLET_A, warnThresholdLamports: 50_000_000 }], fakeLogger);

    expect(results).toEqual([{ label: 'wallet-a', lamports: 200_000_000, belowThreshold: false }]);
    expect(fakeLogger.info).toHaveBeenCalledWith(expect.objectContaining({ label: 'wallet-a', lamports: 200_000_000 }), expect.any(String));
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });

  it('logs warn and reports belowThreshold: true when a balance is below its threshold', async () => {
    getBalance.mockResolvedValue(1_000_000);

    const results = await checkTreasuryBalances(connection(), [{ label: 'wallet-a', publicKey: WALLET_A, warnThresholdLamports: 50_000_000 }], fakeLogger);

    expect(results).toEqual([{ label: 'wallet-a', lamports: 1_000_000, belowThreshold: true }]);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'wallet-a', lamports: 1_000_000, warnThresholdLamports: 50_000_000 }),
      expect.any(String),
    );
  });

  it('checks every wallet in the list independently, in order', async () => {
    getBalance.mockResolvedValueOnce(200_000_000).mockResolvedValueOnce(1_000_000);

    const results = await checkTreasuryBalances(
      connection(),
      [
        { label: 'wallet-a', publicKey: WALLET_A, warnThresholdLamports: 50_000_000 },
        { label: 'wallet-b', publicKey: WALLET_B, warnThresholdLamports: 50_000_000 },
      ],
      fakeLogger,
    );

    expect(results.map((r) => r.label)).toEqual(['wallet-a', 'wallet-b']);
    expect(results[0]?.belowThreshold).toBe(false);
    expect(results[1]?.belowThreshold).toBe(true);
    expect(getBalance).toHaveBeenCalledTimes(2);
    expect((getBalance.mock.calls[0]![0] as PublicKey).toBase58()).toBe(WALLET_A);
    expect((getBalance.mock.calls[1]![0] as PublicKey).toBase58()).toBe(WALLET_B);
  });

  it('one failed check never aborts the rest of the batch, and is reported with null lamports', async () => {
    getBalance.mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValueOnce(200_000_000);

    const results = await checkTreasuryBalances(
      connection(),
      [
        { label: 'wallet-a', publicKey: WALLET_A, warnThresholdLamports: 50_000_000 },
        { label: 'wallet-b', publicKey: WALLET_B, warnThresholdLamports: 50_000_000 },
      ],
      fakeLogger,
    );

    expect(results).toEqual([
      { label: 'wallet-a', lamports: null, belowThreshold: false },
      { label: 'wallet-b', lamports: 200_000_000, belowThreshold: false },
    ]);
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.objectContaining({ label: 'wallet-a' }), expect.any(String));
  });

  it('returns an empty array and makes no RPC calls when given no wallets', async () => {
    const results = await checkTreasuryBalances(connection(), [], fakeLogger);
    expect(results).toEqual([]);
    expect(getBalance).not.toHaveBeenCalled();
  });
});
