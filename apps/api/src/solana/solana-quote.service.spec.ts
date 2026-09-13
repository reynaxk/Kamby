import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
    // Default '50000000' = $50 — exactly the boundary where the tier flips to 75bps; SELL
    // tests that care about a specific tier override this explicitly.
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
    const service = new SolanaQuoteService(jupiter as never, fakeConfig({ SOLANA_ENABLED: false }), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
    expect(jupiter.getQuote).not.toHaveBeenCalled();
  });

  it('rejects when the wallet has never been verified', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the wallet is linked to a different account', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      address: WALLET,
      userId: 'someone-else',
      verifiedAt: new Date(),
      chain: 'SOLANA',
    });
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('rejects an EVM wallet row even if the address string happened to match', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
      address: WALLET,
      userId: 'user-1',
      verifiedAt: new Date(),
      chain: 'EVM',
    });
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(ForbiddenException);
  });

  it('BUY: spends USDC to acquire tokenMint', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    // baseParams.amount ('10' raw units = $0.00001) is well under the $50 tier boundary.
    await service.createQuote({ ...baseParams, side: 'BUY' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: SOLANA_USDC_MINT, outputMint: TOKEN_MINT, feeAccount: TREASURY_ATA, platformFeeBps: 100 }),
    );
  });

  it('BUY: a $50+ trade gets the lower, uncapped 75bps tier, resolved from the input amount directly', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'BUY', amount: '60000000' }); // $60 raw USDC

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 75 }));
    expect(jupiter.getEstimatedOutputRaw).not.toHaveBeenCalled(); // BUY never needs the extra round trip
  });

  it('SELL: sells tokenMint to produce USDC', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: TOKEN_MINT, outputMint: SOLANA_USDC_MINT }),
    );
  });

  it('SELL: discovers the trade\'s USD size via a fee-free, swap-free preliminary quote before resolving the real fee tier', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), '30000000'); // $30 estimated output — under $50
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL', amount: '999999999' }); // input side is irrelevant to the tier here

    expect(jupiter.getEstimatedOutputRaw).toHaveBeenCalledWith(
      expect.objectContaining({ inputMint: TOKEN_MINT, outputMint: SOLANA_USDC_MINT }),
    );
    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 100 }));
  });

  it('SELL: a $50+ estimated output gets the lower, uncapped 75bps tier', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), '75000000'); // $75 estimated output
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 75 }));
  });

  it('passes jitoTipLamports straight through to Jupiter when the caller requests a tip', async () => {
    const jupiter = fakeJupiter();
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, jitoTipLamports: 10_000 });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ jitoTipLamports: 10_000 }));
  });

  it('SELL: falls back to the higher (never the lower) tier when the trade size can\'t actually be discovered', async () => {
    const jupiter = fakeJupiter(fakeJupiterResult(), null); // Jupiter unreachable for the preliminary call
    const service = new SolanaQuoteService(jupiter as never, fakeConfig(), fakeLogger());

    await service.createQuote({ ...baseParams, side: 'SELL' });

    expect(jupiter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ platformFeeBps: 100 }));
  });

  it('rejects when Jupiter cannot produce a live quote', async () => {
    const service = new SolanaQuoteService(fakeJupiter(null) as never, fakeConfig(), fakeLogger());

    await expect(service.createQuote(baseParams)).rejects.toThrow(UnprocessableEntityException);
    expect(mockedPrisma.solanaTradeQuote.create).not.toHaveBeenCalled();
  });

  it('persists the quote with the fields the Jupiter response and request carried', async () => {
    const service = new SolanaQuoteService(fakeJupiter() as never, fakeConfig(), fakeLogger());

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
});
