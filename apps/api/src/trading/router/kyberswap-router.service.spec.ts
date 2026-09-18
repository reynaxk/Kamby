import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import { KyberSwapRouter } from './kyberswap-router.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: 8453,
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_RPC_URL_FALLBACK: undefined,
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    KYBERSWAP_CLIENT_ID: 'kamby-test',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
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

const validRoutesBody = {
  code: 200,
  data: {
    routeSummary: { tokenIn: baseRequest.sellToken, tokenOut: baseRequest.buyToken, amountIn: baseRequest.sellAmountRaw },
    routerAddress: '0xkyberrouter000000000000000000000000000',
  },
};

const validBuildBody = {
  code: 200,
  data: {
    amountOut: '100000000000000000000',
    data: '0xbeef',
    routerAddress: '0xkyberrouter000000000000000000000000000',
    transactionValue: '0',
    gas: '150000',
  },
};

/** Distinguishes the two real KyberSwap endpoints by URL substring, same technique the
 *  old OneInchSwapRouter spec used for /approve/allowance vs. /swap. */
function mockFetchByEndpoint(
  fetchMock: jest.Mock,
  routesBody: unknown,
  buildBody: unknown,
  routesOk = true,
  buildOk = true,
) {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/v1/routes')) return Promise.resolve(jsonResponse(routesBody, routesOk));
    return Promise.resolve(jsonResponse(buildBody, buildOk));
  });
}

describe('KyberSwapRouter', () => {
  let router: KyberSwapRouter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    router = new KyberSwapRouter(fakeConfig(), fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('parses a valid two-call response into the internal SwapRouterQuote shape', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    // The wallet's on-chain allowance is read directly (no KyberSwap allowance endpoint) —
    // stub the underlying client so this test isn't making a real RPC call.
    stubAllowance(router, 0n);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toEqual(
      expect.objectContaining({
        provider: 'kyberswap',
        buyAmountRaw: '100000000000000000000',
        minBuyAmountRaw: '99500000000000000000',
        priceImpactBps: null,
        feeAmountRaw: null,
        requiresApproval: true,
        approvalSpender: '0xkyberrouter000000000000000000000000000',
        unsignedTx: expect.objectContaining({ to: '0xkyberrouter000000000000000000000000000', data: '0xbeef', value: '0' }),
      }),
    );
  });

  it('reports requiresApproval=false when the wallet already has sufficient allowance', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    stubAllowance(router, BigInt(baseRequest.sellAmountRaw));

    const quote = await router.getQuote(baseRequest);

    expect(quote?.requiresApproval).toBe(false);
    expect(quote?.approvalSpender).toBeNull();
  });

  it('skips the allowance check entirely for native ETH', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);

    const quote = await router.getQuote({ ...baseRequest, sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' });

    expect(quote?.requiresApproval).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2); // routes + build only, no on-chain read
  });

  it('sends the fee params only when a fee recipient and non-zero bps are configured', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    stubAllowance(router, 0n);

    await router.getQuote(baseRequest);

    const buildCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/route/build'))!;
    const body = JSON.parse(buildCall[1].body as string) as Record<string, unknown>;
    expect(body.chargeFeeBy).toBe('currency_in');
    expect(body.feeAmount).toBe('50');
    expect(body.isInBps).toBe(true);
    expect(body.feeReceiver).toBe(baseRequest.feeRecipient);
  });

  it('omits fee params entirely when feeBps is zero', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    stubAllowance(router, 0n);

    await router.getQuote({ ...baseRequest, feeBps: 0 });

    const buildCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/route/build'))!;
    const body = JSON.parse(buildCall[1].body as string) as Record<string, unknown>;
    expect(body.chargeFeeBy).toBeUndefined();
    expect(body.feeReceiver).toBeUndefined();
  });

  it('sends the client id via the X-Client-Id header, never requiring an API key', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    stubAllowance(router, 0n);

    await router.getQuote(baseRequest);

    const routesCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/routes'))!;
    const options = routesCall[1] as { headers: Record<string, string> } | undefined;
    expect(options?.headers['x-client-id']).toBe('kamby-test');
  });

  it('returns null when the routes endpoint has no route for this pair', async () => {
    mockFetchByEndpoint(fetchMock, { code: 200, data: undefined }, validBuildBody);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null on a non-ok HTTP response from the routes endpoint, rather than throwing', async () => {
    mockFetchByEndpoint(fetchMock, { message: 'bad request' }, validBuildBody, false, true);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the route prices fine but route/build fails', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, { message: 'oops' }, true, false);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  it('returns null for an unconfigured chainId, without making any request', async () => {
    const quote = await router.getQuote({ ...baseRequest, chainId: 999999 });

    expect(quote).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never guesses) when the allowance check fails, even though the route priced fine', async () => {
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    stubAllowanceFailure(router);

    const quote = await router.getQuote(baseRequest);

    expect(quote).toBeNull();
  });

  // Real bug found and fixed 2026-09-17: Kamby's own chain slug for BNB Chain is 'bnb',
  // but KyberSwap's real API uses 'bsc' in its URLs — confirmed live against the actual
  // API (a '/bnb/...' request 404s, '/bsc/...' returns a real route). Before this fix, BNB
  // trades silently failed with "no live quote available" because every request hit a
  // route that doesn't exist.
  it('uses "bsc", not Kamby\'s own "bnb" slug, when calling KyberSwap for BNB Chain', async () => {
    const bnbRouter = new KyberSwapRouter(
      fakeConfig({
        CHAINS: 'base,bnb',
        CHAIN_BNB_ID: 56,
        CHAIN_BNB_RPC_URL: 'https://bsc-dataseed.binance.org',
        CHAIN_BNB_RPC_URL_FALLBACK: undefined,
        CHAIN_BNB_USDC_ADDRESS: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      }),
      fakeLogger(),
    );
    mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
    const clients = (bnbRouter as unknown as { chainClients: Map<number, { readContract: jest.Mock }> }).chainClients;
    clients.set(56, { readContract: jest.fn().mockResolvedValue(0n) });

    await bnbRouter.getQuote({ ...baseRequest, chainId: 56 });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/bsc/api/v1/'))).toBe(true);
    expect(urls.some((url) => url.includes('/bnb/api/v1/'))).toBe(false);
  });

  // Real speedup added 2026-09-17: a wallet that already has a sufficient allowance (the
  // common case, thanks to TradePanel.tsx's infinite-approval pattern) shouldn't need a
  // fresh on-chain read for every single quote — only the first one for a given
  // (chain, owner, token, spender).
  describe('allowance caching', () => {
    it('skips the on-chain read on a second quote once a sufficient allowance was already observed', async () => {
      mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
      const readContract = jest.fn().mockResolvedValue(BigInt(baseRequest.sellAmountRaw));
      stubAllowanceClient(router, readContract);

      const first = await router.getQuote(baseRequest);
      const second = await router.getQuote(baseRequest);

      expect(first?.requiresApproval).toBe(false);
      expect(second?.requiresApproval).toBe(false);
      expect(readContract).toHaveBeenCalledTimes(1);
    });

    it('still reads on-chain when the cached allowance is not enough for a larger second request', async () => {
      mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
      const smallAmount = '1000';
      const readContract = jest.fn().mockResolvedValue(BigInt(smallAmount));
      stubAllowanceClient(router, readContract);

      await router.getQuote({ ...baseRequest, sellAmountRaw: smallAmount });
      await router.getQuote(baseRequest); // sellAmountRaw far larger than the cached allowance

      expect(readContract).toHaveBeenCalledTimes(2);
    });

    it('re-reads once the cached entry is past its TTL, even though the amount is still covered', async () => {
      mockFetchByEndpoint(fetchMock, validRoutesBody, validBuildBody);
      const readContract = jest.fn().mockResolvedValue(BigInt(baseRequest.sellAmountRaw));
      stubAllowanceClient(router, readContract);

      await router.getQuote(baseRequest);
      expireAllowanceCache(router);
      await router.getQuote(baseRequest);

      expect(readContract).toHaveBeenCalledTimes(2);
    });

    it('never trusts a cache entry for a different spender, even for the same wallet and token', async () => {
      // Two different route/build responses on consecutive calls, each naming a different
      // router contract as the approval spender.
      let call = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/api/v1/routes')) return Promise.resolve(jsonResponse(validRoutesBody));
        call += 1;
        const spender = call === 1 ? '0xspenderone000000000000000000000000000' : '0xspendertwo000000000000000000000000000';
        return Promise.resolve(jsonResponse({ ...validBuildBody, data: { ...validBuildBody.data, routerAddress: spender } }));
      });
      const readContract = jest.fn().mockResolvedValue(BigInt(baseRequest.sellAmountRaw));
      stubAllowanceClient(router, readContract);

      await router.getQuote(baseRequest);
      await router.getQuote(baseRequest);

      expect(readContract).toHaveBeenCalledTimes(2);
    });
  });
});

/** Reaches into the router's own per-chain viem client map to stub `readContract` — same
 *  level of test double the old LiFiSwapRouter spec used, since there's no public seam to
 *  inject a fake client through the constructor without changing production code just for
 *  testability. */
function stubAllowance(router: KyberSwapRouter, allowance: bigint): void {
  const clients = (router as unknown as { chainClients: Map<number, { readContract: jest.Mock }> }).chainClients;
  clients.set(baseRequest.chainId, { readContract: jest.fn().mockResolvedValue(allowance) });
}

function stubAllowanceFailure(router: KyberSwapRouter): void {
  const clients = (router as unknown as { chainClients: Map<number, { readContract: jest.Mock }> }).chainClients;
  clients.set(baseRequest.chainId, { readContract: jest.fn().mockRejectedValue(new Error('RPC unreachable')) });
}

/** Same reach-in technique as stubAllowance, but takes the mock directly so a test can
 *  assert on its call count — the whole point of the allowance-cache tests above. */
function stubAllowanceClient(router: KyberSwapRouter, readContract: jest.Mock): void {
  const clients = (router as unknown as { chainClients: Map<number, { readContract: jest.Mock }> }).chainClients;
  clients.set(baseRequest.chainId, { readContract });
}

/** Backdates every entry in the router's own allowance cache past ALLOWANCE_CACHE_TTL_MS,
 *  without needing fake timers — same reach-in technique as the client stubs above, since
 *  there's no public seam to inject a fake clock through the constructor either. */
function expireAllowanceCache(router: KyberSwapRouter): void {
  const cache = (router as unknown as { allowanceCache: Map<string, { allowance: bigint; cachedAt: number }> }).allowanceCache;
  for (const [key, entry] of cache) cache.set(key, { ...entry, cachedAt: 0 });
}
