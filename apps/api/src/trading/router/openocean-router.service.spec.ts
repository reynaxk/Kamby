import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import { OpenOceanRouter } from './openocean-router.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'bnb',
    DEFAULT_CHAIN_SLUG: 'bnb',
    CHAIN_BNB_ID: 56,
    CHAIN_BNB_RPC_URL: 'https://bsc-dataseed.binance.org',
    CHAIN_BNB_RPC_URL_FALLBACK: undefined,
    CHAIN_BNB_USDC_ADDRESS: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const baseRequest = {
  chainId: 56,
  sellToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buyToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sellAmountRaw: '1000000000000000000',
  taker: '0x1234567890123456789012345678901234567890',
  slippageBps: 50,
  feeRecipient: '0x1111111111111111111111111111111111111a',
  feeBps: 50,
};

const validSwapBody = {
  code: 200,
  data: {
    outAmount: '100000000000000000000',
    minOutAmount: '99500000000000000000',
    to: '0xopenoceanrouter00000000000000000000000',
    data: '0xbeef',
    value: '0',
    estimatedGas: '150000',
  },
};

describe('OpenOceanRouter', () => {
  let router: OpenOceanRouter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    router = new OpenOceanRouter(fakeConfig(), fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // getGasPrice is read on the same per-chain viem client the allowance check uses —
    // default every test to a real-looking value; individual tests override as needed.
    stubClient(router, { getGasPrice: jest.fn().mockResolvedValue(3_000_000_000n), readContract: jest.fn().mockResolvedValue(0n) });
  });

  it('parses a valid /swap response into the internal SwapRouterQuote shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toEqual(
      expect.objectContaining({
        provider: 'openocean',
        buyAmountRaw: '100000000000000000000',
        minBuyAmountRaw: '99500000000000000000',
        priceImpactBps: null,
        feeAmountRaw: null,
        requiresApproval: true,
        approvalSpender: '0xopenoceanrouter00000000000000000000000',
        unsignedTx: expect.objectContaining({
          to: '0xopenoceanrouter00000000000000000000000',
          data: '0xbeef',
          value: '0',
          gas: '150000',
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
        }),
      }),
    );
  });

  it('reports requiresApproval=false when the wallet already has sufficient allowance', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));
    stubClient(router, {
      getGasPrice: jest.fn().mockResolvedValue(3_000_000_000n),
      readContract: jest.fn().mockResolvedValue(BigInt(baseRequest.sellAmountRaw)),
    });

    const quote = await router.getQuote(baseRequest);

    expect(quote?.requiresApproval).toBe(false);
    expect(quote?.approvalSpender).toBeNull();
  });

  it('skips the allowance check entirely for native BNB', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    const quote = await router.getQuote({ ...baseRequest, sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' });

    expect(quote?.requiresApproval).toBe(false);
  });

  it('reads a real current gas price and sends it as gasPriceDecimals', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));
    stubClient(router, { getGasPrice: jest.fn().mockResolvedValue(5_000_000_000n), readContract: jest.fn().mockResolvedValue(0n) });

    await router.getQuote(baseRequest);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('gasPriceDecimals')).toBe('5000000000');
  });

  it('sends the referrer/referrerFee params only when a fee recipient and non-zero bps are configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    await router.getQuote(baseRequest);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('referrer')).toBe(baseRequest.feeRecipient);
    expect(url.searchParams.get('referrerFee')).toBe('0.5'); // 50 bps -> 0.5%
  });

  it('omits referrer params entirely when feeBps is zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    await router.getQuote({ ...baseRequest, feeBps: 0 });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.has('referrer')).toBe(false);
    expect(url.searchParams.has('referrerFee')).toBe(false);
  });

  it('converts slippageBps to a percentage, matching OpenOcean\'s documented 0.05-50 range', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    await router.getQuote({ ...baseRequest, slippageBps: 150 });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('slippage')).toBe('1.5');
  });

  it('hits the bsc-specific URL path for BNB Chain', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));

    await router.getQuote(baseRequest);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/v4/bsc/swap');
  });

  it('returns null when the swap endpoint has no route for this pair', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 200, data: undefined }));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on a non-ok HTTP response, rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'bad request' }, false));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null for an unconfigured chainId, without making any request', async () => {
    const quote = await router.getQuote({ ...baseRequest, chainId: 8453 });

    expect(quote).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never guesses) when the gas price read fails', async () => {
    stubClient(router, { getGasPrice: jest.fn().mockRejectedValue(new Error('RPC unreachable')), readContract: jest.fn() });

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never guesses) when the allowance check fails, even though the swap priced fine', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validSwapBody));
    stubClient(router, {
      getGasPrice: jest.fn().mockResolvedValue(3_000_000_000n),
      readContract: jest.fn().mockRejectedValue(new Error('RPC unreachable')),
    });

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });
});

/** Reaches into the router's own per-chain viem client map — same technique
 *  kyberswap-router.service.spec.ts uses, since there's no public seam to inject a fake
 *  client through the constructor without changing production code just for testability. */
function stubClient(router: OpenOceanRouter, client: { getGasPrice: jest.Mock; readContract: jest.Mock }): void {
  const clients = (router as unknown as { chainClients: Map<number, typeof client> }).chainClients;
  clients.set(baseRequest.chainId, client);
}
