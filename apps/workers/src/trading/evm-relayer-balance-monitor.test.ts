import type { Logger } from 'pino';
import type * as Viem from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEvmRelayerBalance } from './evm-relayer-balance-monitor';

const { getBalanceMock, createPublicClientMock } = vi.hoisted(() => ({
  getBalanceMock: vi.fn(),
  createPublicClientMock: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return { ...actual, createPublicClient: createPublicClientMock };
});

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const RELAYER_ADDRESS = '0x1234567890123456789012345678901234567890';
const RPC_URL = 'https://mainnet.base.org';

describe('checkEvmRelayerBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClientMock.mockReturnValue({ getBalance: getBalanceMock });
  });

  it('logs info (not warn) and reports belowThreshold: false when the balance is comfortably above its threshold', async () => {
    getBalanceMock.mockResolvedValue(2_000_000_000_000_000_000n);

    const result = await checkEvmRelayerBalance(RPC_URL, null, RELAYER_ADDRESS, 5_000_000_000_000_000n, fakeLogger);

    expect(result).toEqual({ label: 'evm-gas-relayer', wei: 2_000_000_000_000_000_000n, belowThreshold: false });
    expect(fakeLogger.info).toHaveBeenCalledWith(expect.objectContaining({ label: 'evm-gas-relayer' }), expect.any(String));
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });

  it('logs warn and reports belowThreshold: true when the balance is below its threshold', async () => {
    getBalanceMock.mockResolvedValue(1_000_000_000_000_000n);

    const result = await checkEvmRelayerBalance(RPC_URL, null, RELAYER_ADDRESS, 5_000_000_000_000_000n, fakeLogger);

    expect(result).toEqual({ label: 'evm-gas-relayer', wei: 1_000_000_000_000_000n, belowThreshold: true });
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'evm-gas-relayer', wei: '1000000000000000', warnThresholdWei: '5000000000000000' }),
      expect.any(String),
    );
  });

  it('never calls getBalance for a malformed address — a real, non-address-shaped public key is a config error, not an RPC failure', async () => {
    const result = await checkEvmRelayerBalance(RPC_URL, null, 'not-an-address', 5_000_000_000_000_000n, fakeLogger);

    expect(result).toEqual({ label: 'evm-gas-relayer', wei: null, belowThreshold: false });
    expect(getBalanceMock).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.objectContaining({ relayerPublicKey: 'not-an-address' }), expect.any(String));
  });

  it('a failed RPC read is reported with null wei, never thrown', async () => {
    getBalanceMock.mockRejectedValue(new Error('RPC timeout'));

    const result = await checkEvmRelayerBalance(RPC_URL, null, RELAYER_ADDRESS, 5_000_000_000_000_000n, fakeLogger);

    expect(result).toEqual({ label: 'evm-gas-relayer', wei: null, belowThreshold: false });
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.objectContaining({ label: 'evm-gas-relayer' }), expect.any(String));
  });

  it('passes both the primary and fallback RPC URL through to the shared transport helper', async () => {
    getBalanceMock.mockResolvedValue(2_000_000_000_000_000_000n);

    await checkEvmRelayerBalance(RPC_URL, 'https://base-fallback.example.com', RELAYER_ADDRESS, 5_000_000_000_000_000n, fakeLogger);

    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
  });
});
