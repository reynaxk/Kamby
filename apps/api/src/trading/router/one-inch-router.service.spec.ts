import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import { OneInchSwapRouter } from './one-inch-router.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  return { get: () => 'test-1inch-api-key' } as unknown as ConfigService<Env, true>;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
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

const validSwapBody = {
  dstAmount: '100000000000000000000',
  tx: { to: '0xdead', data: '0xbeef', value: '0', gas: 21000, gasPrice: '1000000000' },
};

const insufficientAllowanceBody = { allowance: '0' };
const sufficientAllowanceBody = { allowance: '1000000000000000000' };

function mockFetchByEndpoint(fetchMock: jest.Mock, swapBody: unknown, allowanceBody: unknown, swapOk = true, allowanceOk = true) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/approve/allowance')) return Promise.resolve(jsonResponse(allowanceBody, allowanceOk));
    return Promise.resolve(jsonResponse(swapBody, swapOk));
  });
}

describe('OneInchSwapRouter', () => {
  let router: OneInchSwapRouter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    router = new OneInchSwapRouter(fakeConfig(), fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('parses a valid response into the internal SwapRouterQuote shape', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, insufficientAllowanceBody);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toEqual(
      expect.objectContaining({
        provider: '1inch',
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

  it('reports requiresApproval=false when the wallet already has sufficient allowance', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, sufficientAllowanceBody);

    const quote = await router.getQuote(baseRequest);

    expect(quote?.requiresApproval).toBe(false);
    expect(quote?.approvalSpender).toBeNull();
  });

  it('skips the allowance check entirely for native ETH', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, insufficientAllowanceBody);

    const quote = await router.getQuote({ ...baseRequest, sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' });

    expect(quote?.requiresApproval).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the platform fee params only when a fee recipient and non-zero bps are configured', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, insufficientAllowanceBody);

    await router.getQuote(baseRequest);

    const swapCall = fetchMock.mock.calls.find((c) => !String(c[0]).includes('/approve/allowance'))!;
    const calledUrl = new URL(swapCall[0] as string);
    expect(calledUrl.searchParams.get('fee')).toBe('0.5');
    expect(calledUrl.searchParams.get('referrer')).toBe(baseRequest.feeRecipient);
  });

  it('omits fee params entirely when feeBps is zero', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, insufficientAllowanceBody);

    await router.getQuote({ ...baseRequest, feeBps: 0 });

    const swapCall = fetchMock.mock.calls.find((c) => !String(c[0]).includes('/approve/allowance'))!;
    const calledUrl = new URL(swapCall[0] as string);
    expect(calledUrl.searchParams.has('fee')).toBe(false);
  });

  it('sends the API key via the Authorization header, never in the URL', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, insufficientAllowanceBody);

    await router.getQuote(baseRequest);

    const swapCall = fetchMock.mock.calls.find((c) => !String(c[0]).includes('/approve/allowance'))!;
    const options = swapCall[1] as { headers: Record<string, string> };
    expect(options.headers.Authorization).toBe('Bearer test-1inch-api-key');
    expect(String(swapCall[0])).not.toContain('test-1inch-api-key');
  });

  it('returns null when the response is missing required transaction fields', async () => {
    mockFetchByEndpoint(fetchMock, { dstAmount: '100', tx: { to: '0xdead' } }, insufficientAllowanceBody);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on a non-ok HTTP response from the swap endpoint, rather than throwing', async () => {
    mockFetchByEndpoint(fetchMock, { reason: 'bad request' }, insufficientAllowanceBody, false, true);

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

  it('returns null (never guesses) when the allowance check fails, even though the swap priced fine', async () => {
    mockFetchByEndpoint(fetchMock, validSwapBody, { reason: 'nope' }, true, false);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });
});
