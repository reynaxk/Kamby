import type { PinoLogger } from 'nestjs-pino';
import { JupiterQuoteService, type JupiterQuoteParams } from './jupiter-quote.service';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const baseParams: JupiterQuoteParams = {
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  outputMint: 'So11111111111111111111111111111111111111112',
  amountRaw: '10000000',
  slippageBps: 50,
  userPublicKey: '11111111111111111111111111111111111111112',
  platformFeeBps: 50,
  feeAccount: 'FeeAccountAddressForTestingOnly1111111111',
};

const validQuoteBody = {
  inAmount: '10000000',
  outAmount: '50000000',
  otherAmountThreshold: '49750000',
  priceImpactPct: '0.0012',
  platformFee: { amount: '50000', feeBps: 50 },
};

const validSwapBody = { swapTransaction: 'base64-serialized-unsigned-transaction' };

describe('JupiterQuoteService', () => {
  let service: JupiterQuoteService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new JupiterQuoteService(fakeLogger());
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('parses a valid quote + swap response into the internal result shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validQuoteBody)).mockResolvedValueOnce(jsonResponse(validSwapBody));

    const result = await service.getQuote(baseParams);

    expect(result).toEqual({
      inputMint: baseParams.inputMint,
      outputMint: baseParams.outputMint,
      inputAmountRaw: '10000000',
      outputAmountRaw: '50000000',
      minOutputAmountRaw: '49750000',
      priceImpactBps: 12, // 0.0012 * 10_000
      platformFeeBps: 50,
      platformFeeAmountRaw: '50000',
      unsignedTxBase64: 'base64-serialized-unsigned-transaction',
    });
  });

  it('sends platformFeeBps on the quote call and feeAccount on the swap call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validQuoteBody)).mockResolvedValueOnce(jsonResponse(validSwapBody));

    await service.getQuote(baseParams);

    const quoteUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(quoteUrl.searchParams.get('platformFeeBps')).toBe('50');
    expect(quoteUrl.searchParams.get('inputMint')).toBe(baseParams.inputMint);
    expect(quoteUrl.searchParams.get('outputMint')).toBe(baseParams.outputMint);

    const swapCall = fetchMock.mock.calls[1];
    const swapBody = JSON.parse(swapCall[1].body as string) as Record<string, unknown>;
    expect(swapBody.feeAccount).toBe(baseParams.feeAccount);
    expect(swapBody.userPublicKey).toBe(baseParams.userPublicKey);
  });

  it('omits platformFeeBps and feeAccount entirely when platformFeeBps is zero', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validQuoteBody)).mockResolvedValueOnce(jsonResponse(validSwapBody));

    await service.getQuote({ ...baseParams, platformFeeBps: 0 });

    const quoteUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(quoteUrl.searchParams.has('platformFeeBps')).toBe(false);

    const swapBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as Record<string, unknown>;
    expect(swapBody.feeAccount).toBeUndefined();
  });

  it('returns null (never guesses) when the quote endpoint rejects the request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, false, 400));

    const result = await service.getQuote(baseParams);

    expect(result).toBeNull();
  });

  it('returns null when the quote succeeds but the swap-build call fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validQuoteBody)).mockResolvedValueOnce(jsonResponse({ error: 'oops' }, false, 500));

    const result = await service.getQuote(baseParams);

    expect(result).toBeNull();
  });

  it('returns null when the network request itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await service.getQuote(baseParams);

    expect(result).toBeNull();
  });

  it('returns null priceImpactBps (never fabricated) when Jupiter omits priceImpactPct', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...validQuoteBody, priceImpactPct: undefined }))
      .mockResolvedValueOnce(jsonResponse(validSwapBody));

    const result = await service.getQuote(baseParams);

    expect(result?.priceImpactBps).toBeNull();
  });

  it('returns null platformFeeAmountRaw (never fabricated) when Jupiter omits platformFee', async () => {
    const { platformFee: _platformFee, ...withoutFee } = validQuoteBody;
    fetchMock.mockResolvedValueOnce(jsonResponse(withoutFee)).mockResolvedValueOnce(jsonResponse(validSwapBody));

    const result = await service.getQuote(baseParams);

    expect(result?.platformFeeAmountRaw).toBeNull();
  });
});
