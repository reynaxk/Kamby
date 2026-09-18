import { UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import type { PinoLogger } from 'nestjs-pino';
import type { SolanaConnectionPool } from '../chain/solana-connection-pool';
import type { Env } from '../config/env';
import { SolanaTopupService } from './solana-topup.service';

const mockGetBalance = jest.fn();
const mockSendAndConfirmTransaction = jest.fn();

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    sendAndConfirmTransaction: (...args: unknown[]) => mockSendAndConfirmTransaction(...args),
  };
});

// A real keypair — Keypair.fromSecretKey needs real, correctly-shaped bytes; there's no
// meaningful way to "fake" this without it being exactly a real Ed25519 keypair.
const FUNDING_KEYPAIR = Keypair.generate();
const RECIPIENT = Keypair.generate().publicKey.toBase58();

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SOLANA_ENABLED: true,
    SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    SOLANA_TREASURY_USDC_ATA: 'TreasuryUsdcAtaForTestingOnly11111111111',
    SOLANA_JUPITER_PLATFORM_FEE_BPS: 50,
    SOLANA_NEW_WALLET_TOPUP_SOL: 0.01,
    SOLANA_TOPUP_FUNDING_SECRET_KEY: bs58.encode(FUNDING_KEYPAIR.secretKey),
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('SolanaTopupService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects when Solana trading is not enabled on this deployment', async () => {
    const service = new SolanaTopupService(fakeConfig({ SOLANA_ENABLED: false }), fakeLogger(), null);

    await expect(service.ensureFunded(RECIPIENT)).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects when a deployment has funding configured but no connection pool (Solana disabled)', async () => {
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), null);

    await expect(service.ensureFunded(RECIPIENT)).rejects.toThrow(UnprocessableEntityException);
  });

  it('is a no-op when the wallet already has enough SOL', async () => {
    mockGetBalance.mockResolvedValue(20_000_000); // 0.02 SOL, above the 0.01 SOL top-up amount
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), fakePoolWithBalance());

    const result = await service.ensureFunded(RECIPIENT);

    expect(result).toEqual({ toppedUp: false, signature: null });
    expect(mockSendAndConfirmTransaction).not.toHaveBeenCalled();
  });

  it('sends the configured top-up amount to a wallet below the threshold', async () => {
    mockGetBalance.mockResolvedValue(0);
    mockSendAndConfirmTransaction.mockResolvedValue('fake-signature');
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), fakePoolWithBalance());

    const result = await service.ensureFunded(RECIPIENT);

    expect(result).toEqual({ toppedUp: true, signature: 'fake-signature' });
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
  });

  it('sends exactly one instruction — a fixed System Program transfer — never more', async () => {
    mockGetBalance.mockResolvedValue(0);
    mockSendAndConfirmTransaction.mockImplementation((_connection, transaction) => {
      expect(transaction.instructions).toHaveLength(1);
      expect(transaction.instructions[0].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
      return Promise.resolve('fake-signature');
    });
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), fakePoolWithBalance());

    await service.ensureFunded(RECIPIENT);

    expect(mockSendAndConfirmTransaction).toHaveBeenCalled();
  });

  it('never throws when the top-up transaction itself fails — a failed top-up is not fatal', async () => {
    mockGetBalance.mockResolvedValue(0);
    mockSendAndConfirmTransaction.mockRejectedValue(new Error('RPC unreachable'));
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), fakePoolWithBalance());

    const result = await service.ensureFunded(RECIPIENT);

    expect(result).toEqual({ toppedUp: false, signature: null });
  });

  it('tops up when the balance cannot be read at all, rather than assuming it is already funded', async () => {
    mockGetBalance.mockRejectedValue(new Error('RPC unreachable'));
    mockSendAndConfirmTransaction.mockResolvedValue('fake-signature');
    const service = new SolanaTopupService(fakeConfig(), fakeLogger(), fakePoolWithBalance());

    const result = await service.ensureFunded(RECIPIENT);

    expect(result).toEqual({ toppedUp: true, signature: 'fake-signature' });
  });
});

/** Same shape as fakePool() but wires `getBalance` on the fake connection to mockGetBalance
 *  — the balance check needs a real (fake) method to call, unlike sendAndConfirmTransaction
 *  which is mocked as a free function at the module level. */
function fakePoolWithBalance(): SolanaConnectionPool {
  return {
    withFailover: (operation: (connection: { getBalance: jest.Mock }) => Promise<unknown>) =>
      operation({ getBalance: mockGetBalance }),
  } as unknown as SolanaConnectionPool;
}
