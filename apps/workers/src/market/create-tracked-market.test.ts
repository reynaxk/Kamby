import { EvmChainDataProvider, UniswapV3PoolReader } from '@kamby/chain-adapters';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrackedMarket } from './create-tracked-market';

const mockPrisma = vi.hoisted(() => ({
  token: { upsert: vi.fn() },
  tokenMarket: { upsert: vi.fn() },
  ingestionCursor: { upsert: vi.fn() },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const POOL_ADDRESS = '0x1111111111111111111111111111111111aaaa';
const BASE_TOKEN = '0x2222222222222222222222222222222222bbbb';
const QUOTE_TOKEN = '0x3333333333333333333333333333333333cccc';

function fakePoolState(overrides: Partial<{ token0: string; token1: string; feeTier: number }> = {}) {
  return {
    token0: BASE_TOKEN,
    token1: QUOTE_TOKEN,
    feeTier: 3000,
    sqrtPriceX96: 1_000_000_000_000_000_000n,
    tick: 0,
    ...overrides,
  };
}

function fakeMetadata(overrides: Partial<{ symbol: string | null; name: string | null; decimals: number | null }> = {}) {
  return { symbol: 'TEST', name: 'Test Token', decimals: 18, ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockPrisma.token.upsert.mockImplementation(async ({ create }: { create: { contractAddress: string } }) => ({
    id: `token-${create.contractAddress}`,
  }));
  mockPrisma.tokenMarket.upsert.mockResolvedValue({ id: 'market-1' });
  mockPrisma.ingestionCursor.upsert.mockResolvedValue({});
});

describe('createTrackedMarket', () => {
  it('returns false and never touches Postgres when the pool state is unreadable', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(null);
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    const result = await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(result).toBe(false);
    expect(mockPrisma.tokenMarket.upsert).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ pool: POOL_ADDRESS }), expect.stringContaining('pool state unreadable'));
  });

  it('identifies the quote token as token1 when the base token is token0', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState({ token0: BASE_TOKEN, token1: QUOTE_TOKEN }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.tokenMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tokenId: `token-${BASE_TOKEN}`, quoteTokenId: `token-${QUOTE_TOKEN}` }) }),
    );
  });

  it('identifies the quote token as token0 when the base token is token1', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState({ token0: QUOTE_TOKEN, token1: BASE_TOKEN }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.tokenMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tokenId: `token-${BASE_TOKEN}`, quoteTokenId: `token-${QUOTE_TOKEN}` }) }),
    );
  });

  it('matches the base token address case-insensitively against the pool state', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState({ token0: BASE_TOKEN.toUpperCase(), token1: QUOTE_TOKEN }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    // A lowercase baseTokenAddress must still match the pool's uppercase token0 — real
    // addresses arrive in whatever case an event/seed-list entry happens to use.
    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.tokenMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tokenId: `token-${BASE_TOKEN}`, quoteTokenId: `token-${QUOTE_TOKEN}` }) }),
    );
  });

  it('creates a TokenMarket with the real pool address, dex label, and fee tier read from the pool', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState({ feeTier: 10_000 }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:56', name: 'BNB Chain', nativeSymbol: 'BNB' }, rpcUrl: 'http://127.0.0.1:0' });

    const result = await createTrackedMarket(poolReader, tokenReader, 56, POOL_ADDRESS, BASE_TOKEN, 'pancakeswap-v3', fakeLogger);

    expect(result).toBe(true);
    expect(mockPrisma.tokenMarket.upsert).toHaveBeenCalledWith({
      where: { chainId_pairAddress: { chainId: 56, pairAddress: POOL_ADDRESS } },
      update: { dex: 'pancakeswap-v3', feeTier: 10_000 },
      create: expect.objectContaining({ chainId: 56, dex: 'pancakeswap-v3', pairAddress: POOL_ADDRESS, feeTier: 10_000 }),
    });
  });

  it('backfills the cursor to latestBlock minus the initial backfill window on a fresh market', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState());
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.ingestionCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { tokenMarketId: 'market-1', lastProcessedBlock: 1_000_000n - 3_600n } }),
    );
  });

  it('never backfills to a negative block number on a very early/low latestBlock (defensive edge case)', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState());
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100n); // well under the 3,600-block backfill window
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.ingestionCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { tokenMarketId: 'market-1', lastProcessedBlock: 0n } }));
  });

  it('leaves tokenId/quoteTokenId untouched on update — only dex/feeTier are meant to change for an already-tracked pool', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState({ feeTier: 500 }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    const call = mockPrisma.tokenMarket.upsert.mock.calls[0]![0];
    expect(call.update).toEqual({ dex: 'uniswap-v3', feeTier: 500 });
    expect(call.update).not.toHaveProperty('tokenId');
    expect(call.update).not.toHaveProperty('quoteTokenId');
  });

  it('reuses an existing IngestionCursor rather than resetting it on an already-tracked pool (empty update)', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState());
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(100_000n);
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(mockPrisma.ingestionCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });

  it('returns false defensively if the token upsert step ever resolves falsy, without creating a TokenMarket', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(fakePoolState());
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue(fakeMetadata());
    mockPrisma.token.upsert.mockResolvedValueOnce(null); // base token upsert fails to resolve a row
    const poolReader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const tokenReader = new EvmChainDataProvider({ chain: { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' }, rpcUrl: 'http://127.0.0.1:0' });

    const result = await createTrackedMarket(poolReader, tokenReader, 1, POOL_ADDRESS, BASE_TOKEN, 'uniswap-v3', fakeLogger);

    expect(result).toBe(false);
    expect(mockPrisma.tokenMarket.upsert).not.toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ pool: POOL_ADDRESS }), expect.stringContaining('token metadata unreadable'));
  });
});
