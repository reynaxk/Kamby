import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { calculateFeeAmount, PLATFORM_FEE_FALLBACK_BPS, resolveTierFeeBps, TRADING_DEFAULTS } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { parseUnits } from 'viem';
import type { Env } from '../config/env';
import { QuoteService } from './quote.service';
import type { SafetyService, TradableMarket } from './safety.service';
import type { SwapRouter, SwapRouterQuote } from './router/swap-router.interface';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn() },
    tradeQuote: { create: jest.fn() },
  },
}));

// FOO/WETH (fakeMarket()) is a non-USDC-quoted market — every BUY against it now needs a
// fee-free pre-quote to resolve its tier (see QuoteService#resolveAggregatorTierFeeBps).
// `fakeRouter()`'s single mocked `getQuote` answers both that pre-quote and the real,
// fee-bearing call with the same `routerQuote()` fixture unless a test overrides it: the
// default 100-token buyAmountRaw × fakeMarket().priceUsd (2.5) resolves to $250, which is
// this file's `DEFAULT_ROUTER_QUOTE_TIER_BPS` below.
const DEFAULT_ROUTER_QUOTE_TIER_BPS = resolveTierFeeBps(100 * 2.5);

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const WALLET = '0x1234567890123456789012345678901234567890';
const USER_ID = 'user-1';

const TOKEN = { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 };
const QUOTE_TOKEN = { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'WETH', decimals: 18 };
// Deliberately never equal to QUOTE_TOKEN above — every existing test in this file trades
// against a WETH-quoted market, so it exercises the older, unchanged aggregator-fee path
// unless a test explicitly opts into a USDC-quoted market (see "guaranteed USDC fees" below).
const CONFIGURED_USDC = '0xdddddddddddddddddddddddddddddddddddddddd';
const USDC_QUOTE_TOKEN = { contractAddress: CONFIGURED_USDC, symbol: 'USDC', decimals: 6 };

function fakeMarket(): TradableMarket {
  return {
    id: 'market-1',
    priceUsd: '2.5',
    token: TOKEN,
    quoteToken: QUOTE_TOKEN,
  } as unknown as TradableMarket;
}

function fakeSafety(market: TradableMarket = fakeMarket()): SafetyService {
  return { assertTradable: jest.fn().mockResolvedValue(market) } as unknown as SafetyService;
}

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    PLATFORM_FEE_BPS: 50,
    PLATFORM_FEE_RECIPIENT_ADDRESS: '0x111111111111111111111111111111111111111a',
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: 8453,
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_USDC_ADDRESS: CONFIGURED_USDC,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function routerQuote(overrides: Partial<SwapRouterQuote> = {}): SwapRouterQuote {
  const buyAmountRaw = parseUnits('100', 18).toString();
  return {
    provider: 'li.fi',
    providerQuoteId: null,
    buyAmountRaw,
    sellAmountRaw: parseUnits('1', 18).toString(),
    minBuyAmountRaw: parseUnits('99.5', 18).toString(), // honors 50 bps slippage on 100
    priceImpactBps: 42,
    feeAmountRaw: null,
    requiresApproval: false,
    approvalSpender: null,
    unsignedTx: { to: '0xdead', data: '0xbeef', value: '0', gas: '21000', maxFeePerGas: null, maxPriorityFeePerGas: null },
    ...overrides,
  };
}

function fakeRouter(quote: SwapRouterQuote | null = routerQuote()): SwapRouter {
  return { getQuote: jest.fn().mockResolvedValue(quote) } as unknown as SwapRouter;
}

describe('QuoteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: USER_ID, verifiedAt: new Date() });
    (mockedPrisma.tradeQuote.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'quote-1', createdAt: new Date(), ...data }),
    );
  });

  function buildService(overrides: { safety?: SafetyService; router?: SwapRouter; config?: ConfigService<Env, true> } = {}) {
    return new QuoteService(overrides.safety ?? fakeSafety(), overrides.router ?? fakeRouter(), overrides.config ?? fakeConfig(), fakeLogger());
  }

  describe('wallet ownership', () => {
    it('rejects when the wallet has never been linked to anyone', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);
      const service = buildService();

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the wallet is linked to a different account', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: 'someone-else', verifiedAt: new Date() });
      const service = buildService();

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a wallet that is linked but never verified', async () => {
      (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ userId: USER_ID, verifiedAt: null });
      const service = buildService();

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('input validation', () => {
    it.each(['0', '-1', 'abc', '', '1.2.3'])('rejects a malformed or non-positive amount %p', async (amount) => {
      const service = buildService();

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount, slippageBps: 50 }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('quote availability', () => {
    it('surfaces an honest error when the router has no live quote — never a fabricated one', async () => {
      const service = buildService({ router: fakeRouter(null) });

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects a quote whose provider-side minimum output is looser than the requested slippage guarantees', async () => {
      // Requested 50 bps slippage on a 100-token buy demands a floor of >= 99.5; provider offers only 90.
      const service = buildService({ router: fakeRouter(routerQuote({ minBuyAmountRaw: parseUnits('90', 18).toString() })) });

      await expect(
        service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('fee math', () => {
    it('uses the provider-reported fee when present', async () => {
      const providerFee = parseUnits('0.3', 18).toString();
      const service = buildService({ router: fakeRouter(routerQuote({ feeAmountRaw: providerFee })) });

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '1',
        slippageBps: 50,
      });

      expect(quote.platformFeeAmount).toBe(providerFee);
    });

    it('computes the platform fee from the tier matching the buy amount when the provider reports none', async () => {
      const service = buildService();
      const buyAmountRaw = parseUnits('100', 18);
      const expectedFee = calculateFeeAmount(buyAmountRaw, DEFAULT_ROUTER_QUOTE_TIER_BPS);

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '1',
        slippageBps: 50,
      });

      expect(quote.platformFeeAmount).toBe(expectedFee.toString());
      expect(quote.platformFeeBps).toBe(DEFAULT_ROUTER_QUOTE_TIER_BPS);
    });

    it('picks a cheaper tier for a larger trade and a pricier tier for a smaller one — never a single flat rate', async () => {
      // A pre-quote buy amount worth $25 (10 tokens × $2.5) lands in the 2% tier; $2,500
      // (1000 tokens × $2.5) lands in the 0.75% tier — same market, same config, different
      // trade size is the only thing that moves the rate.
      const smallRouter = fakeRouter(routerQuote({ buyAmountRaw: parseUnits('10', 18).toString(), minBuyAmountRaw: parseUnits('9.95', 18).toString() }));
      const smallService = buildService({ router: smallRouter });
      const smallQuote = await smallService.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 });
      expect(smallQuote.platformFeeBps).toBe(200);

      const largeRouter = fakeRouter(routerQuote({ buyAmountRaw: parseUnits('1000', 18).toString(), minBuyAmountRaw: parseUnits('995', 18).toString() }));
      const largeService = buildService({ router: largeRouter });
      const largeQuote = await largeService.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 });
      expect(largeQuote.platformFeeBps).toBe(75);
    });

    it('falls back to the most expensive tier, never a cheaper unconfirmed one, when the BUY pre-quote itself fails', async () => {
      const router = { getQuote: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(routerQuote()) } as unknown as SwapRouter;
      const service = buildService({ router });

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '1',
        slippageBps: 50,
      });

      expect(quote.platformFeeBps).toBe(PLATFORM_FEE_FALLBACK_BPS);
      expect(router.getQuote).toHaveBeenCalledTimes(2);
    });
  });

  describe('successful quote shape', () => {
    it('returns a fully-populated DTO with the honest safety disclaimer and never a "safe" claim', async () => {
      const service = buildService();

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '1',
        slippageBps: 50,
      });

      expect(quote.safetyNote.toLowerCase()).not.toContain('safe to trade');
      expect(quote.provider).toBe('li.fi');
      expect(quote.expiresAt).toBeDefined();
      // expiresAt and createdAt come from two separate Date.now() calls a few lines apart
      // (createdAt via the mocked prisma.create, expiresAt computed just before it) — allow
      // a small real-clock tolerance instead of exact equality.
      const ttlMs = new Date(quote.expiresAt).getTime() - new Date(quote.createdAt).getTime();
      expect(Math.abs(ttlMs - TRADING_DEFAULTS.quoteTtlSeconds * 1000)).toBeLessThan(50);
      expect(quote.token.address).toBe(TOKEN.contractAddress);
      expect(quote.quoteToken.address).toBe(QUOTE_TOKEN.contractAddress);
    });

    it('resolves BUY input=quoteToken/output=token and SELL input=token/output=quoteToken', async () => {
      const buyRouter = fakeRouter();
      const buyService = buildService({ router: buyRouter });
      await buyService.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '1', slippageBps: 50 });
      expect(buyRouter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ sellToken: QUOTE_TOKEN.contractAddress, buyToken: TOKEN.contractAddress }));

      const sellRouter = fakeRouter();
      const sellService = buildService({ router: sellRouter });
      await sellService.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'SELL', amount: '1', slippageBps: 50 });
      expect(sellRouter.getQuote).toHaveBeenCalledWith(expect.objectContaining({ sellToken: TOKEN.contractAddress, buyToken: QUOTE_TOKEN.contractAddress }));
    });
  });

  describe('guaranteed USDC fees', () => {
    function fakeUsdcMarket(): TradableMarket {
      return { id: 'market-usdc', priceUsd: '2500', token: TOKEN, quoteToken: USDC_QUOTE_TOKEN } as unknown as TradableMarket;
    }

    it('leaves a non-USDC-quoted market on the old aggregator-fee path — no feeUnsignedTx, full amount sent to the router', async () => {
      const router = fakeRouter();
      const service = buildService({ router, safety: fakeSafety(fakeMarket()) }); // fakeMarket()'s quoteToken is WETH, not USDC

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '1',
        slippageBps: 50,
      });

      expect(quote.feeUnsignedTx).toBeNull();
      // Two calls now: a fee-free pre-quote to discover the trade's USD size (see
      // resolveAggregatorTierFeeBps), then the real, fee-bearing call asserted here.
      expect(router.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ sellAmountRaw: parseUnits('1', 18).toString(), feeBps: DEFAULT_ROUTER_QUOTE_TIER_BPS, feeRecipient: '0x111111111111111111111111111111111111111a' }),
      );
      expect(router.getQuote).toHaveBeenCalledTimes(2);
    });

    it('BUY on a USDC-quoted market: deducts the fee from the input before quoting the swap, and builds a separate fee transfer', async () => {
      const router = fakeRouter();
      const service = buildService({ router, safety: fakeSafety(fakeUsdcMarket()) });

      const fullInput = parseUnits('100', 6); // 100 USDC, USDC uses 6 decimals — the 1% tier
      const expectedFee = calculateFeeAmount(fullInput, resolveTierFeeBps(100));
      const expectedSwapAmount = fullInput - expectedFee;

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'BUY',
        amount: '100',
        slippageBps: 50,
      });

      // The router is only ever asked to price the post-fee remainder, and never asked to
      // apply its own fee — Kamby is handling the fee itself for this market.
      expect(router.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ sellAmountRaw: expectedSwapAmount.toString(), feeBps: 0, feeRecipient: null }),
      );
      expect(quote.platformFeeAmount).toBe(expectedFee.toString());
      // inputAmount stays the user's full original amount — what they typed, not just the
      // post-fee swap portion — so their trade history reads honestly.
      expect(quote.inputAmount).toBe(fullInput.toString());
      expect(quote.feeUnsignedTx).not.toBeNull();
      expect(quote.feeUnsignedTx!.to).toBe(CONFIGURED_USDC); // the fee transfer targets the USDC contract
    });

    it('SELL on a USDC-quoted market: swaps the full amount, then takes the fee from the quoted (gross) USDC output separately', async () => {
      const grossOutput = parseUnits('250', 6); // 250 USDC gross from the swap
      const router = fakeRouter(routerQuote({ buyAmountRaw: grossOutput.toString(), minBuyAmountRaw: parseUnits('248.75', 6).toString() }));
      const service = buildService({ router, safety: fakeSafety(fakeUsdcMarket()) });

      const expectedFee = calculateFeeAmount(grossOutput, resolveTierFeeBps(250)); // 250 USDC gross — the 1% tier
      const expectedNetOutput = grossOutput - expectedFee;

      const quote = await service.createQuote({
        userId: USER_ID,
        walletAddress: WALLET,
        tokenAddress: TOKEN.contractAddress,
        chainId: 8453, side: 'SELL',
        amount: '1',
        slippageBps: 50,
      });

      // The swap itself is quoted for the full token amount — nothing held back pre-swap.
      expect(router.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ sellAmountRaw: parseUnits('1', 18).toString(), feeBps: 0, feeRecipient: null }),
      );
      expect(quote.platformFeeAmount).toBe(expectedFee.toString());
      // What the user is shown as their expected output is net of Kamby's fee, even though
      // the on-chain swap itself will produce the full gross amount.
      expect(quote.expectedOutputAmount).toBe(expectedNetOutput.toString());
      expect(quote.feeUnsignedTx).not.toBeNull();
      expect(quote.feeUnsignedTx!.to).toBe(CONFIGURED_USDC);
    });

    it('never double-charges: the router is never asked to also apply its own fee when Kamby is handling it separately', async () => {
      const router = fakeRouter();
      const service = buildService({ router, safety: fakeSafety(fakeUsdcMarket()) });

      await service.createQuote({ userId: USER_ID, walletAddress: WALLET, tokenAddress: TOKEN.contractAddress, chainId: 8453, side: 'BUY', amount: '10', slippageBps: 50 });

      const call = (router.getQuote as jest.Mock).mock.calls[0][0];
      expect(call.feeBps).toBe(0);
      expect(call.feeRecipient).toBeNull();
    });
  });
});
