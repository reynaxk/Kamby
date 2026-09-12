import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import { LiFiSwapRouter } from './li-fi-router.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) => {
      if (key === 'LIFI_API_KEY') return 'test-lifi-api-key';
      if (key === 'LIFI_INTEGRATOR') return 'kamby-test';
      if (key === 'CHAINS') return 'base';
      if (key === 'DEFAULT_CHAIN_SLUG') return 'base';
      if (key === 'CHAIN_BASE_ID') return 8453;
      if (key === 'CHAIN_BASE_RPC_URL') return 'https://mainnet.base.org';
      if (key === 'CHAIN_BASE_USDC_ADDRESS') return '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      return undefined;
    },
  } as unknown as ConfigService<Env, true>;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Swaps out the router's internal viem client for a mock `readContract`, since the real
 *  client is constructed internally from config rather than injected. Defaults to chain
 *  8453 (baseRequest's own chainId) — pass a different chainId to simulate a client for a
 *  *different* chain than the request asks for. */
function mockAllowance(router: LiFiSwapRouter, readContract: jest.Mock, chainId = 8453) {
  (router as unknown as { chainClients: Map<number, { readContract: jest.Mock }> }).chainClients = new Map([
    [chainId, { readContract }],
  ]);
}

const baseRequest = {
  chainId: 8453,
  sellToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buyToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sellAmountRaw: '1000000000000000000',
  taker: '0x1234567890123456789012345678901234567890',
  slippageBps: 50,
  feeRecipient: '0x1111111111111111111111111111111111111a',
  feeBps: 50,
};

const validBody = {
  estimate: { toAmount: '100000000000000000000', toAmountMin: '99500000000000000000' },
  transactionRequest: { to: '0xdead', data: '0xbeef', value: '0', gasLimit: '21000', gasPrice: '1000000000' },
};

describe('LiFiSwapRouter', () => {
  let router: LiFiSwapRouter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    router = new LiFiSwapRouter(fakeConfig(), fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('parses a valid response into the internal SwapRouterQuote shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockResolvedValue(0n));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toEqual(
      expect.objectContaining({
        provider: 'li.fi',
        buyAmountRaw: '100000000000000000000',
        minBuyAmountRaw: '99500000000000000000',
        priceImpactBps: null,
        feeAmountRaw: null,
        requiresApproval: true,
        approvalSpender: '0xdead',
        unsignedTx: expect.objectContaining({ to: '0xdead', data: '0xbeef', value: '0' }),
      }),
    );
  });

  it('reports requiresApproval=false when on-chain allowance already covers the sell amount', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockResolvedValue(BigInt(baseRequest.sellAmountRaw)));

    const quote = await router.getQuote(baseRequest);

    expect(quote?.requiresApproval).toBe(false);
    expect(quote?.approvalSpender).toBeNull();
  });

  it('skips the on-chain allowance read entirely for native ETH', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    const readContract = jest.fn();
    mockAllowance(router, readContract);

    const quote = await router.getQuote({ ...baseRequest, sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' });

    expect(quote?.requiresApproval).toBe(false);
    expect(readContract).not.toHaveBeenCalled();
  });

  it('sends the platform fee and integrator params only when a fee recipient and non-zero bps are configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockResolvedValue(0n));

    await router.getQuote(baseRequest);

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('fee')).toBe('0.005');
    expect(calledUrl.searchParams.get('integrator')).toBe('kamby-test');
  });

  it('omits the fee param entirely when feeBps is zero', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockResolvedValue(0n));

    await router.getQuote({ ...baseRequest, feeBps: 0 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.has('fee')).toBe(false);
  });

  it('sends the API key via the x-lifi-api-key header, never in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockResolvedValue(0n));

    await router.getQuote(baseRequest);

    const options = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers['x-lifi-api-key']).toBe('test-lifi-api-key');
    expect(fetchMock.mock.calls[0][0] as string).not.toContain('test-lifi-api-key');
  });

  it('returns null when the response is missing required fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ estimate: { toAmount: '100' } }));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on a non-ok HTTP response, rather than throwing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: 'bad request' }, false, 400));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on an unparseable JSON body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) } as unknown as Response);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null (never guesses) when the on-chain allowance read fails, even though the quote priced fine', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    mockAllowance(router, jest.fn().mockRejectedValue(new Error('RPC unreachable')));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('never falls back to a different chain\'s client when the request names a chainId this process has no client for', async () => {
    fetchMock.mockResolvedValue(jsonResponse(validBody));
    // A client exists, but only for chain 42161 (Arbitrum) — baseRequest asks for 8453.
    const arbitrumReadContract = jest.fn().mockResolvedValue(0n);
    mockAllowance(router, arbitrumReadContract, 42161);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
    expect(arbitrumReadContract).not.toHaveBeenCalled();
  });
});
