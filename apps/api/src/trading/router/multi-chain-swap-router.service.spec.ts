import type { PinoLogger } from 'nestjs-pino';
import type { KyberSwapRouter } from './kyberswap-router.service';
import { MultiChainSwapRouter } from './multi-chain-swap-router.service';
import type { OpenOceanRouter } from './openocean-router.service';
import type { SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeQuote(provider: string): SwapRouterQuote {
  return {
    provider,
    providerQuoteId: null,
    buyAmountRaw: '1',
    sellAmountRaw: '1',
    minBuyAmountRaw: '1',
    priceImpactBps: null,
    feeAmountRaw: null,
    requiresApproval: false,
    approvalSpender: null,
    unsignedTx: { to: '0x0', data: '0x', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
  };
}

function fakeRequest(chainId: number): SwapRouterQuoteRequest {
  return {
    chainId,
    sellToken: '0xa',
    buyToken: '0xb',
    sellAmountRaw: '1',
    taker: '0xc',
    slippageBps: 50,
    feeRecipient: null,
    feeBps: 0,
  };
}

describe('MultiChainSwapRouter', () => {
  let kyberswap: { getQuote: jest.Mock };
  let openocean: { getQuote: jest.Mock };
  let router: MultiChainSwapRouter;

  beforeEach(() => {
    kyberswap = { getQuote: jest.fn().mockResolvedValue(fakeQuote('kyberswap')) };
    openocean = { getQuote: jest.fn().mockResolvedValue(fakeQuote('openocean')) };
    router = new MultiChainSwapRouter(kyberswap as unknown as KyberSwapRouter, openocean as unknown as OpenOceanRouter, fakeLogger());
  });

  it('routes Base (8453) to KyberSwap, never OpenOcean', async () => {
    const quote = await router.getQuote(fakeRequest(8453));

    expect(quote?.provider).toBe('kyberswap');
    expect(kyberswap.getQuote).toHaveBeenCalledTimes(1);
    expect(openocean.getQuote).not.toHaveBeenCalled();
  });

  it('routes Arbitrum (42161) to KyberSwap, never OpenOcean', async () => {
    const quote = await router.getQuote(fakeRequest(42161));

    expect(quote?.provider).toBe('kyberswap');
    expect(openocean.getQuote).not.toHaveBeenCalled();
  });

  // BNB Chain moved from OpenOcean to KyberSwap 2026-09-17 — the first real trade attempt
  // found OpenOcean's public API blocked behind a Cloudflare bot-challenge (HTTP 403) for
  // every request, verified from multiple independent networks. See
  // MultiChainSwapRouter's own doc comment on CHAIN_ID_TO_PROVIDER.
  it('routes BNB Chain (56) to KyberSwap, never OpenOcean', async () => {
    const quote = await router.getQuote(fakeRequest(56));

    expect(quote?.provider).toBe('kyberswap');
    expect(kyberswap.getQuote).toHaveBeenCalledTimes(1);
    expect(openocean.getQuote).not.toHaveBeenCalled();
  });

  it('routes Ethereum mainnet (1) to KyberSwap, never OpenOcean', async () => {
    const quote = await router.getQuote(fakeRequest(1));

    expect(quote?.provider).toBe('kyberswap');
    expect(kyberswap.getQuote).toHaveBeenCalledTimes(1);
    expect(openocean.getQuote).not.toHaveBeenCalled();
  });

  it('returns null for a chainId with no mapped provider, without calling either router', async () => {
    const quote = await router.getQuote(fakeRequest(999_999));

    expect(quote).toBeNull();
    expect(kyberswap.getQuote).not.toHaveBeenCalled();
    expect(openocean.getQuote).not.toHaveBeenCalled();
  });

  it('propagates a null quote from the chosen provider as-is (no fabricated fallback)', async () => {
    kyberswap.getQuote.mockResolvedValue(null);

    const quote = await router.getQuote(fakeRequest(56));

    expect(quote).toBeNull();
  });
});
