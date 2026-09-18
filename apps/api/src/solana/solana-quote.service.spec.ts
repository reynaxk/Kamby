import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Keypair, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { prisma } from '@kamby/db';
import { SOLANA_USDC_MINT } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import type { JupiterQuoteResult } from './jupiter-quote.service';
import { SolanaQuoteService, type CreateSolanaQuoteParams } from './solana-quote.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn() },
    solanaTradeQuote: { create: jest.fn() },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const WALLET = 'FakeWalletAddressForTestingOnly1111111111';
const TOKEN_MINT = 'So11111111111111111111111111111111111111112';
const TREASURY_ATA = 'TreasuryUsdcAtaForTestingOnly11111111111';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

// None of createQuote's own tests exercise the sponsored path — a bare, "not configured"
// stand-in is all they need; createSponsoredQuote gets its own dedicated tests with a real
// fake below.
function fakeGasRelayer() {
  return { feePayerPublicKey: null, relayerConnection: null };
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SOLANA_ENABLED: true,
    SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    SOLANA_TREASURY_USDC_ATA: TREASURY_ATA,
    SOLANA_JUPITER_PLATFORM_FEE_BPS: 50,
    SOLANA_NEW_WALLET_TOPUP_SOL: 0.01,
    SOLANA_TOPUP_FUNDING_SECRET_KEY: 'fake-secret-key',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeJupiterResult(overrides: Partial<JupiterQuoteResult> = {}): JupiterQuoteResult {
  return {
    inputMint: SOLANA_USDC_MINT,
    outputMint: TOKEN_MINT,
    inputAmountRaw: '10000000',
    outputAmountRaw: '50000000',
    minOutputAmountRaw: '49750000',
    priceImpactBps: 12,
    platformFeeBps: 50,
    platformFeeAmountRaw: '50000',
    unsignedTxBase64: 'base64-unsigned-tx',
    ...overrides,
  };
}

function fakeJupiter(result: JupiterQuoteResult | null = fakeJupiterResult(), estimatedOutputRaw: string | null = '50000000') {
  return {
    getQuote: jest.fn().mockResolvedValue(result),
    // Default '50000000' = $50, comfortably inside the lowest (200bps) tier; SELL tests
    // that care about a specific tier override this explicitly.
    getEstimatedOutputRaw: jest.fn().mockResolvedValue(estimatedOutputRaw),
  };
}

const baseParams: CreateSolanaQuoteParams = {
  userId: 'user-1',
  walletAddress: WALLET,
  side: 'BUY',
  tokenMint: TOKEN_MINT,
  amount: '10',
  slippageBps: 50,
};

describe('SolanaQuoteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      address: WALLET,
      userId: 'user-1',
      verifiedAt: new Date(),
      chain: 'SOLANA',
    });
    (mockedPrisma.solanaTradeQuote.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'quote-1', createdAt: new Date(), ...data }),
    );
  });

  it('rejects when Solana trading is not enabled on this deployment', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig({ SOLANA_ENABLED: false }), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
    expect(jupiter.getQuote).not.toHaveBeenCalled();
  });

  it('rejects when the wallet has never been verified', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the wallet is linked to a different account', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      address: WALLET,
      userId: 'someone-else',
      verifiedAt: new Date(),
      chain: 'SOLANA',
    });
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('rejects an EVM wallet row even if the address string happened to match', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      address: WALLET,
      userId: 'user-1',
      verifiedAt: new Date(),
      chain: 'EVM',
    });
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('BUY: spends USDC to acquire tokenMint', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    // baseParams.amount ('10' raw units = $0.00001) is well under the $100 tier boundary.
    await service.createQuote({ ...baseParams, side: 'BUY' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: SOLANA_USDC_MINT, outputMint: TOKEN_MINT, feeAccount: TREASURY_ATA, platformFeeBps: 200 }),
    );
  });

  it('BUY: a $100-$499.99 trade gets the middle 100bps tier, resolved from the input amount directly', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'BUY', amount: '150000000' }); // $150 raw USDC

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 100 }));
    expect(jupiter.getEstimatedOutputRaw).not.toHaveBeenCalled(); // BUY never needs the extra round trip
  });

  it('BUY: a $500+ trade gets the lowest, uncapped 75bps tier', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'BUY', amount: '600000000' }); // $600 raw USDC

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 75 }));
  });

  it('SELL: sells tokenMint to produce USDC', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: TOKEN_MINT, outputMint: SOLANA_USDC_MINT }),
    );
  });

  it('SELL: discovers the trade\'s USD size via a fee-free, swap-free preliminary quote before resolving the real fee tier', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), '30000000'); // $30 estimated output — under $100
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL', amount: '999999999' }); // input side is irrelevant to the tier here

    expect(jupiter.getEstimatedOutputRaw).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: TOKEN_MINT, outputMint: SOLANA_USDC_MINT }),
    );
    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 200 }));
  });

  it('SELL: a $100-$499.99 estimated output gets the middle 100bps tier', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), '150000000'); // $150 estimated output
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 100 }));
  });

  it('SELL: a $500+ estimated output gets the lowest, uncapped 75bps tier', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), '600000000'); // $600 estimated output
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 75 }));
  });

  it('passes jitoTipLamports straight through to Jupiter when the caller requests a tip', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, jitoTipLamports: 10_000 });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ jitoTipLamports: 10_000 }));
  });

  it('SELL: falls back to the highest (never a cheaper) tier when the trade size can\'t actually be discovered', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), null); // Jupiter unreachable for the preliminary call
    const service = new SolanaQuoteService(jupiter as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 200 }));
  });

  it('rejects when Jupiter cannot produce a live quote', async () => {
    const service = new SolanaQuoteService(fakeJupiter(null) as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
    expect(mockedPrisma.solanaTradeQuote.create).not.toHaveBeenCalled();
  });

  it('persists the quote with the fields the Jupiter response and request carried', async () => {
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

    const result = await service.createQuote(baseParams);

    expect(mockedPrisma.solanaTradeQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          walletAddress: WALLET,
          side: 'BUY',
          inputMint: SOLANA_USDC_MINT,
          outputMint: TOKEN_MINT,
          inputAmount: '10000000',
          expectedOutputAmount: '50000000',
          minOutputAmount: '49750000',
          slippageBps: 50,
          platformFeeBps: 50,
          platformFeeAmount: '50000',
        }),
      }),
    );
    expect(result.id).toBe('quote-1');
    expect(result.unsignedTxBase64).toBe('base64-unsigned-tx');
  });

  describe('createSponsoredQuote', () => {
    const RELAYER_PUBLIC_KEY = Keypair.generate().publicKey.toBase58();

    function fakeConfiguredGasRelayer(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        feePayerPublicKey: RELAYER_PUBLIC_KEY,
        relayerConnection: {
          getAddressLookupTable: jest.fn().mockResolvedValue({ value: null }),
          getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58() }),
        },
        ...overrides,
      };
    }

    function fakeSwapInstructionsResult(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        inputAmountRaw: '10000000',
        outputAmountRaw: '50000000',
        minOutputAmountRaw: '49750000',
        priceImpactBps: 12,
        platformFeeAmountRaw: '50000',
        computeBudgetInstructions: [],
        setupInstructions: [],
        swapInstruction: {
          programId: SystemProgram.programId.toBase58(),
          accounts: [{ pubkey: Keypair.generate().publicKey.toBase58(), isSigner: true, isWritable: false }],
          data: Buffer.from([1, 2, 3]).toString('base64'),
        },
        cleanupInstruction: null,
        addressLookupTableAddresses: [],
        ...overrides,
      };
    }

    function fakeJupiterWithSwapInstructions(result: unknown = fakeSwapInstructionsResult()) {
      return { getSwapInstructions: jest.fn().mockResolvedValue(result) };
    }

    it('rejects when Solana trading is not enabled on this deployment', async () => {
      const service = new SolanaQuoteService(
        fakeJupiterWithSwapInstructions() as never,
        fakeConfiguredGasRelayer() as never,
        fakeConfig({ SOLANA_ENABLED: false }),
        fakeLogger(),
      );

      await expect(service.createSponsoredQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects when gas sponsorship is not enabled on this deployment', async () => {
      const service = new SolanaQuoteService(fakeJupiterWithSwapInstructions() as never, fakeGasRelayer() as never, fakeConfig(), fakeLogger());

      await expect(service.createSponsoredQuote(baseParams)).rejects.toThrow(/gas sponsorship is not enabled/i);
    });

    describe('test-wallet rollout gate', () => {
      it('rejects a wallet not on the configured test-wallet allowlist, with the exact same message as "not enabled at all"', async () => {
        const service = new SolanaQuoteService(
          fakeJupiterWithSwapInstructions() as never,
          fakeConfiguredGasRelayer() as never,
          fakeConfig({ SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: 'SomeoneElsesWallet1111111111111111111111' }),
          fakeLogger(),
        );

        await expect(service.createSponsoredQuote(baseParams)).rejects.toThrow(/gas sponsorship is not enabled/i);
      });

      it('accepts a wallet that is on the configured test-wallet allowlist', async () => {
        const jupiter = fakeJupiterWithSwapInstructions();
        const service = new SolanaQuoteService(
          jupiter as never,
          fakeConfiguredGasRelayer() as never,
          fakeConfig({ SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: `SomeoneElsesWallet1111111111111111111111,${WALLET}` }),
          fakeLogger(),
        );

        await service.createSponsoredQuote(baseParams);

        expect(jupiter.getSwapInstructions).toHaveBeenCalled();
      });

      it('imposes no restriction when the allowlist is unset — every wallet remains eligible, unchanged from before this gate existed', async () => {
        const jupiter = fakeJupiterWithSwapInstructions();
        const service = new SolanaQuoteService(jupiter as never, fakeConfiguredGasRelayer() as never, fakeConfig(), fakeLogger());

        await service.createSponsoredQuote(baseParams);

        expect(jupiter.getSwapInstructions).toHaveBeenCalled();
      });
    });

    it('rejects when the wallet has never been verified — same ownership contract as the self-paid path', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new SolanaQuoteService(
        fakeJupiterWithSwapInstructions() as never,
        fakeConfiguredGasRelayer() as never,
        fakeConfig(),
        fakeLogger(),
      );

      await expect(service.createSponsoredQuote(baseParams)).rejects.toThrow(ForbiddenException);
    });

    it('requests instructions with the relayer — never the caller\'s own wallet — as payer', async () => {
      const jupiter = fakeJupiterWithSwapInstructions();
      const service = new SolanaQuoteService(jupiter as never, fakeConfiguredGasRelayer() as never, fakeConfig(), fakeLogger());

      await service.createSponsoredQuote(baseParams);

      expect(jupiter.getSwapInstructions).toHaveBeenCalledWith(expect.objectContaining({ payer: RELAYER_PUBLIC_KEY, userPublicKey: WALLET }));
    });

    it('rejects when Jupiter cannot produce live swap instructions', async () => {
      const service = new SolanaQuoteService(
        fakeJupiterWithSwapInstructions(null) as never,
        fakeConfiguredGasRelayer() as never,
        fakeConfig(),
        fakeLogger(),
      );

      await expect(service.createSponsoredQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.solanaTradeQuote.create).not.toHaveBeenCalled();
    });

    it('assembles and persists a real unsigned transaction naming the relayer as fee payer', async () => {
      const jupiter = fakeJupiterWithSwapInstructions();
      const gasRelayer = fakeConfiguredGasRelayer();
      const service = new SolanaQuoteService(jupiter as never, gasRelayer as never, fakeConfig(), fakeLogger());

      const result = await service.createSponsoredQuote(baseParams);

      expect(mockedPrisma.solanaTradeQuote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            walletAddress: WALLET,
            inputAmount: '10000000',
            expectedOutputAmount: '50000000',
            platformFeeAmount: '50000',
          }),
        }),
      );
      expect(result.unsignedTxBase64).toEqual(expect.any(String));
      expect(result.unsignedTxBase64.length).toBeGreaterThan(0);

      // The real, load-bearing assertion: the assembled transaction's fee payer (account
      // index 0, by protocol convention) is genuinely the relayer, not the caller's wallet.
      const bytes = Buffer.from(result.unsignedTxBase64, 'base64');
      const decoded = VersionedTransaction.deserialize(bytes);
      expect(decoded.message.staticAccountKeys[0]!.toBase58()).toBe(RELAYER_PUBLIC_KEY);
    });
  });
});
