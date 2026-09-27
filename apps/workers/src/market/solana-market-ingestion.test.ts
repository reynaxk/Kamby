import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SolanaMarketIngestionService } from './solana-market-ingestion';
import { SOLANA_SEED_MARKETS } from './solana-seed-markets';

const mockPrisma = vi.hoisted(() => ({
  solanaTokenMarket: {
    upsert: vi.fn(),
  },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function fakePair(mintAddress: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    baseToken: { address: mintAddress, symbol: 'BONK', name: 'Bonk' },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
    priceUsd: '0.000003685',
    liquidity: { usd: 429_592.7 },
    volume: { h24: 1_199_460.04 },
    priceChange: { h24: 6.2 },
    marketCap: 324_317_627,
    info: { imageUrl: 'https://example.test/bonk.png' },
    ...overrides,
  };
}

function mockFetchSequence(responses: (unknown | null)[]): void {
  const fetchMock = vi.fn();
  for (const body of responses) {
    fetchMock.mockResolvedValueOnce(
      body === null ? { ok: false, status: 500 } : { ok: true, json: async () => body },
    );
  }
  vi.stubGlobal('fetch', fetchMock);
}

describe('SolanaMarketIngestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('queries DexScreener once per seed mint and upserts a row for each', async () => {
    mockFetchSequence(SOLANA_SEED_MARKETS.map((m) => ({ pairs: [fakePair(m.mintAddress)] })));
    const service = new SolanaMarketIngestionService(fakeLogger);

    const result = await service.run();

    expect(result).toEqual({ attempted: SOLANA_SEED_MARKETS.length, updated: SOLANA_SEED_MARKETS.length, skipped: 0 });
    expect(mockPrisma.solanaTokenMarket.upsert).toHaveBeenCalledTimes(SOLANA_SEED_MARKETS.length);
  });

  it('picks the deepest-liquidity pair when DexScreener returns several for the same mint', async () => {
    const firstMint = SOLANA_SEED_MARKETS[0]!.mintAddress;
    mockFetchSequence([
      {
        pairs: [
          fakePair(firstMint, { dexId: 'orca', liquidity: { usd: 1_000 } }),
          fakePair(firstMint, { dexId: 'raydium', liquidity: { usd: 429_592.7 } }),
        ],
      },
      ...SOLANA_SEED_MARKETS.slice(1).map((m) => ({ pairs: [fakePair(m.mintAddress)] })),
    ]);
    const service = new SolanaMarketIngestionService(fakeLogger);

    await service.run();

    expect(mockPrisma.solanaTokenMarket.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ update: expect.objectContaining({ dex: 'raydium', liquidityUsd: 429_592.7 }) }),
    );
  });

  it('skips a mint honestly (never fabricates a row) when DexScreener has no real pair for it', async () => {
    mockFetchSequence([{ pairs: [] }, ...SOLANA_SEED_MARKETS.slice(1).map((m) => ({ pairs: [fakePair(m.mintAddress)] }))]);
    const service = new SolanaMarketIngestionService(fakeLogger);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(SOLANA_SEED_MARKETS.length - 1);
  });

  it('does not let one mint failing (a non-ok response) stop the rest of the tick', async () => {
    mockFetchSequence([null, ...SOLANA_SEED_MARKETS.slice(1).map((m) => ({ pairs: [fakePair(m.mintAddress)] }))]);
    const service = new SolanaMarketIngestionService(fakeLogger);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(SOLANA_SEED_MARKETS.length - 1);
    expect(mockPrisma.solanaTokenMarket.upsert).toHaveBeenCalledTimes(SOLANA_SEED_MARKETS.length - 1);
  });

  it('does not let one mint throwing (a rejected fetch) stop the rest of the tick', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    for (const m of SOLANA_SEED_MARKETS.slice(1)) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ pairs: [fakePair(m.mintAddress)] }) });
    }
    vi.stubGlobal('fetch', fetchMock);
    const service = new SolanaMarketIngestionService(fakeLogger);

    const result = await service.run();

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(SOLANA_SEED_MARKETS.length - 1);
    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ mintAddress: SOLANA_SEED_MARKETS[0]!.mintAddress }),
      expect.stringContaining('failed to update one mint'),
    );
  });
});
