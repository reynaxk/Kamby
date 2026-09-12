import type { PinoLogger } from 'nestjs-pino';
import { MetaAggregatorSwapRouter } from './meta-aggregator-router.service';
import type { LiFiSwapRouter } from './li-fi-router.service';
import type { OneInchSwapRouter } from './one-inch-router.service';
import type { SwapRouterQuote } from './swap-router.interface';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function quote(overrides: Partial<SwapRouterQuote> = {}): SwapRouterQuote {
  return {
    provider: 'test',
    providerQuoteId: null,
    buyAmountRaw: '100',
    sellAmountRaw: '1',
    minBuyAmountRaw: '99',
    priceImpactBps: null,
    feeAmountRaw: null,
    requiresApproval: false,
    approvalSpender: null,
    unsignedTx: { to: '0xdead', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    ...overrides,
  };
}

const baseRequest = {
  chainId: 8453,
  sellToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buyToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sellAmountRaw: '1000000000000000000',
  taker: '0x1234567890123456789012345678901234567890',
  slippageBps: 50,
  feeRecipient: null,
  feeBps: 0,
};

function fakeLifi(impl: () => Promise<SwapRouterQuote | null>): LiFiSwapRouter {
  return { getQuote: jest.fn(impl) } as unknown as LiFiSwapRouter;
}

function fakeOneInch(impl: () => Promise<SwapRouterQuote | null>): OneInchSwapRouter {
  return { getQuote: jest.fn(impl) } as unknown as OneInchSwapRouter;
}

describe('MetaAggregatorSwapRouter', () => {
  it('picks the provider with the higher output amount', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => Promise.resolve(quote({ provider: 'li.fi', buyAmountRaw: '100' }))),
      fakeOneInch(() => Promise.resolve(quote({ provider: '1inch', buyAmountRaw: '150' }))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result?.provider).toBe('1inch');
    expect(result?.buyAmountRaw).toBe('150');
  });

  it('picks li.fi when it quotes higher', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => Promise.resolve(quote({ provider: 'li.fi', buyAmountRaw: '200' }))),
      fakeOneInch(() => Promise.resolve(quote({ provider: '1inch', buyAmountRaw: '150' }))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result?.provider).toBe('li.fi');
  });

  it('falls back to the sole successful provider when the other returns null', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => Promise.resolve(null)),
      fakeOneInch(() => Promise.resolve(quote({ provider: '1inch' }))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result?.provider).toBe('1inch');
  });

  it('falls back to the sole successful provider when the other throws', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => Promise.reject(new Error('ECONNRESET'))),
      fakeOneInch(() => Promise.resolve(quote({ provider: '1inch' }))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result?.provider).toBe('1inch');
  });

  it('returns null (never fabricates) when both providers fail', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => Promise.resolve(null)),
      fakeOneInch(() => Promise.reject(new Error('ECONNRESET'))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result).toBeNull();
  });

  it('treats a provider that never resolves as a timeout, not a hang', async () => {
    const router = new MetaAggregatorSwapRouter(
      fakeLifi(() => new Promise(() => {})), // never resolves
      fakeOneInch(() => Promise.resolve(quote({ provider: '1inch' }))),
      fakeLogger(),
    );

    const result = await router.getQuote(baseRequest);

    expect(result?.provider).toBe('1inch');
  }, 6000);
});
