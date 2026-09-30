import { EvmChainDataProvider, UniswapV3PoolReader } from '@kamby/chain-adapters';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geckoTerminalCandidate, PoolDiscoveryService } from './pool-discovery';

const mockPrisma = vi.hoisted(() => ({
  chain: { upsert: vi.fn() },
  token: { findUnique: vi.fn(), upsert: vi.fn() },
  tokenMarket: { findFirst: vi.fn(), upsert: vi.fn() },
  ingestionCursor: { upsert: vi.fn() },
}));

vi.mock('@kamby/db', () => ({ prisma: mockPrisma }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const FACTORY = '0xFACT0000000000000000000000000000000000';
const USDC = '0xUSDC0000000000000000000000000000000000';
const KNOWN_TOKEN = '0xKN0W0000000000000000000000000000000000'; // already tracked elsewhere
const UNKNOWN_TOKEN_A = '0xAAAA000000000000000000000000000000000A';
const UNKNOWN_TOKEN_B = '0xBBBB000000000000000000000000000000000B';
const POOL_A = '0xPOOLA000000000000000000000000000000000A';
const POOL_B = '0xPOOLB000000000000000000000000000000000B';

function fakeRedis() {
  const store = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    hexists: vi.fn(async (key: string, field: string) => (hashes.get(key)?.has(field) ? 1 : 0)),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, value);
    }),
    hgetall: vi.fn(async (key: string) => Object.fromEntries(hashes.get(key) ?? new Map())),
    hdel: vi.fn(async (key: string, field: string) => {
      hashes.get(key)?.delete(field);
    }),
    _hashes: hashes,
  };
}

function newService(redis: ReturnType<typeof fakeRedis>, overrides: Partial<ConstructorParameters<typeof PoolDiscoveryService>[0]> = {}) {
  return new PoolDiscoveryService(
    {
      chainIdentifier: 'eip155:8453',
      chainName: 'Base',
      chainNativeSymbol: 'ETH',
      factoryAddress: FACTORY,
      quoteUsdcAddress: USDC,
      dex: 'uniswap-v3',
      liquidityFloorUsd: 100_000,
      ...overrides,
    },
    'http://127.0.0.1:0',
    fakeLogger,
    redis as never,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Without this, a promoted pool's createTrackedMarket call would hit the real
  // DexScreener API for its logo lookup (fetchTokenLogoUrl) — slow, flaky, and an unwanted
  // network dependency for a unit test. Default: no image found.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) }));
  mockPrisma.chain.upsert.mockResolvedValue({ id: 1 });
  mockPrisma.token.findUnique.mockResolvedValue(null);
  mockPrisma.tokenMarket.findFirst.mockResolvedValue(null);
});

describe('PoolDiscoveryService.discoverNewPools', () => {
  it('bounds eth_getLogs to exactly one MAX_BLOCKS_PER_TICK-wide chunk per tick', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    const getPoolCreatedEvents = vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([]);
    const redis = fakeRedis();

    await newService(redis).discoverNewPools();

    expect(getPoolCreatedEvents).toHaveBeenCalledTimes(1);
    const [, fromBlock, toBlock] = getPoolCreatedEvents.mock.calls[0]!;
    expect(toBlock - fromBlock).toBeLessThanOrEqual(150n);
  });

  it('starts one chunk back from the latest block on the very first run (no stored cursor)', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    const getPoolCreatedEvents = vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([]);
    const redis = fakeRedis();

    await newService(redis).discoverNewPools();

    const [, fromBlock] = getPoolCreatedEvents.mock.calls[0]!;
    expect(fromBlock).toBe(1_000_000n - 150n + 1n);
  });

  it('resumes from the persisted cursor on a later run, never re-scanning already-processed blocks', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_500n);
    const getPoolCreatedEvents = vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([]);
    const redis = fakeRedis();
    await redis.set('pool-discovery:cursor:eip155:8453', '1000000');

    await newService(redis).discoverNewPools();

    const [, fromBlock] = getPoolCreatedEvents.mock.calls[0]!;
    expect(fromBlock).toBe(1_000_001n);
  });

  it('does not advance the cursor when eth_getLogs fails, so the range is retried next tick', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue(null);
    const redis = fakeRedis();

    await newService(redis).discoverNewPools();

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('skips a discovered pool entirely when neither token is known — never trackable, never fabricated', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([
      { token0: UNKNOWN_TOKEN_A, token1: UNKNOWN_TOKEN_B, fee: 3000, pool: POOL_A, blockNumber: 999_990n },
    ]);
    const redis = fakeRedis();

    const result = await newService(redis).discoverNewPools();

    expect(result.discovered).toBe(0);
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it("tracks a discovered pool as pending when one side is the chain's own USDC peg", async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([
      { token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, pool: POOL_A, blockNumber: 999_990n },
    ]);
    const redis = fakeRedis();

    const result = await newService(redis).discoverNewPools();

    expect(result.discovered).toBe(1);
    expect(redis.hset).toHaveBeenCalledWith('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase(), expect.stringContaining('"knownSide":"token1"'));
  });

  it('tracks a discovered pool as pending when one side is already a tracked token on this chain', async () => {
    mockPrisma.token.findUnique.mockImplementation(async ({ where }: { where: { chainId_contractAddress: { contractAddress: string } } }) =>
      where.chainId_contractAddress.contractAddress === KNOWN_TOKEN ? { id: 'token-known' } : null,
    );
    mockPrisma.tokenMarket.findFirst.mockResolvedValue({ id: 'market-1' }); // this known token is tracked somewhere
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([
      { token0: KNOWN_TOKEN, token1: UNKNOWN_TOKEN_A, fee: 3000, pool: POOL_A, blockNumber: 999_990n },
    ]);
    const redis = fakeRedis();

    const result = await newService(redis).discoverNewPools();

    expect(result.discovered).toBe(1);
    expect(redis.hset).toHaveBeenCalledWith('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase(), expect.stringContaining('"knownSide":"token0"'));
  });

  it('does not re-track a pool already in the pending set', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolCreatedEvents').mockResolvedValue([
      { token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, pool: POOL_A, blockNumber: 999_990n },
    ]);
    const redis = fakeRedis();
    await redis.hset('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase(), '{}');

    const result = await newService(redis).discoverNewPools();

    expect(result.discovered).toBe(0);
  });
});

describe('PoolDiscoveryService.checkPendingPools', () => {
  it('promotes a pending pool once its real on-chain liquidity clears the floor', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue({
      token0: UNKNOWN_TOKEN_A,
      token1: USDC,
      feeTier: 3000,
      sqrtPriceX96: 79228162514264337593543950336n, // price ratio of exactly 1.0
      tick: 0,
    });
    vi.spyOn(UniswapV3PoolReader.prototype, 'getTokenBalance').mockResolvedValue(1_000_000_000_000_000_000_000n); // 1000 tokens, 18 decimals
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockImplementation(async (address: string) => ({
      symbol: address === USDC ? 'USDC' : 'NEW',
      name: address === USDC ? 'USD Coin' : 'New Token',
      decimals: address === USDC ? 6 : 18,
    }));
    vi.spyOn(UniswapV3PoolReader.prototype, 'getLatestBlockNumber').mockResolvedValue(1_000_000n);
    mockPrisma.tokenMarket.upsert.mockResolvedValue({ id: 'market-new' });
    mockPrisma.token.upsert.mockImplementation(async ({ create }: { create: { contractAddress: string } }) => ({
      id: create.contractAddress === USDC ? 'token-usdc' : 'token-new',
    }));

    const redis = fakeRedis();
    await redis.hset(
      'pool-discovery:pending:eip155:8453',
      POOL_A.toLowerCase(),
      JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }),
    );

    const result = await newService(redis, { liquidityFloorUsd: 100 }).checkPendingPools();

    expect(result.promoted).toBe(1);
    expect(mockPrisma.tokenMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chainId_pairAddress: { chainId: 1, pairAddress: POOL_A.toLowerCase() } },
        create: expect.objectContaining({ tokenId: 'token-new', quoteTokenId: 'token-usdc' }),
      }),
    );
    expect(redis.hdel).toHaveBeenCalledWith('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase());
  });

  it('leaves a pending pool in place, never promoting it, when real liquidity is still below the floor', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue({
      token0: UNKNOWN_TOKEN_A,
      token1: USDC,
      feeTier: 3000,
      sqrtPriceX96: 79228162514264337593543950336n,
      tick: 0,
    });
    vi.spyOn(UniswapV3PoolReader.prototype, 'getTokenBalance').mockResolvedValue(1n); // dust
    vi.spyOn(EvmChainDataProvider.prototype, 'getTokenMetadata').mockResolvedValue({ symbol: 'X', name: 'X', decimals: 18 });

    const redis = fakeRedis();
    await redis.hset(
      'pool-discovery:pending:eip155:8453',
      POOL_A.toLowerCase(),
      JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }),
    );

    const result = await newService(redis, { liquidityFloorUsd: 100_000 }).checkPendingPools();

    expect(result.promoted).toBe(0);
    expect(mockPrisma.tokenMarket.upsert).not.toHaveBeenCalled();
    expect(redis.hdel).not.toHaveBeenCalled();
  });

  it('gives up on a pending pool older than the max age, without ever promoting it', async () => {
    const getPoolState = vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState');
    const redis = fakeRedis();
    await redis.hset(
      'pool-discovery:pending:eip155:8453',
      POOL_A.toLowerCase(),
      JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() - 15 * 24 * 60 * 60_000 }),
    );

    const result = await newService(redis).checkPendingPools();

    expect(result.expired).toBe(1);
    expect(result.promoted).toBe(0);
    expect(getPoolState).not.toHaveBeenCalled(); // gave up before spending any RPC budget on it
    expect(redis.hdel).toHaveBeenCalledWith('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase());
  });

  it('checks at most MAX_PENDING_CHECKS_PER_TICK pools in one tick, regardless of how many are pending', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(null); // fail fast, only call-count matters here
    const redis = fakeRedis();
    for (let i = 0; i < 15; i++) {
      await redis.hset(
        'pool-discovery:pending:eip155:8453',
        `0xpool${i}`,
        JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }),
      );
    }

    const result = await newService(redis).checkPendingPools();

    expect(result.pendingChecked).toBe(10);
  });

  it("does not let one pending pool's check throwing stop the rest of the tick", async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState')
      .mockRejectedValueOnce(new Error('RPC exploded'))
      .mockResolvedValueOnce(null);
    const redis = fakeRedis();
    await redis.hset('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase(), JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }));
    await redis.hset('pool-discovery:pending:eip155:8453', POOL_B.toLowerCase(), JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }));

    const result = await newService(redis).checkPendingPools();

    expect(result.pendingChecked).toBe(2);
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.objectContaining({ pool: POOL_A.toLowerCase() }), expect.stringContaining('threw'));
  });
});

// A real Uniswap V3 pool row from GeckoTerminal's Base trending feed (2026-09-30), trimmed.
function geckoPool(overrides: { dex?: string; reserve?: string; buyers?: number; sellers?: number; base?: string; quote?: string; address?: string } = {}) {
  return {
    attributes: {
      address: overrides.address ?? POOL_B,
      reserve_in_usd: overrides.reserve ?? '1833899.29',
      transactions: { h24: { buyers: overrides.buyers ?? 12_807, sellers: overrides.sellers ?? 12_589 } },
    },
    relationships: {
      base_token: { data: { id: `base_${overrides.base ?? UNKNOWN_TOKEN_B}` } },
      quote_token: { data: { id: `base_${overrides.quote ?? USDC}` } },
      dex: { data: { id: overrides.dex ?? 'uniswap-v3-base' } },
    },
  };
}

describe('geckoTerminalCandidate', () => {
  const dexIds = ['uniswap-v3-base'];

  it('accepts a readable V3 pool with real reserves and two-sided trading', () => {
    expect(geckoTerminalCandidate(geckoPool(), dexIds)).toEqual({ pool: POOL_B, tokenA: UNKNOWN_TOKEN_B, tokenB: USDC });
  });

  it('skips pools ingestion cannot read, thin pools, and one-sided (honeypot-shaped) trading', () => {
    expect(geckoTerminalCandidate(geckoPool({ dex: 'aerodrome-slipstream' }), dexIds)).toBeNull();
    expect(geckoTerminalCandidate(geckoPool({ reserve: '9999' }), dexIds)).toBeNull();
    expect(geckoTerminalCandidate(geckoPool({ sellers: 3 }), dexIds)).toBeNull();
    expect(geckoTerminalCandidate(geckoPool({ buyers: 5 }), dexIds)).toBeNull();
  });
});

describe('PoolDiscoveryService.enqueueFromGeckoTerminal', () => {
  it('queues a qualifying pool for the on-chain check, ordered like the pool itself, at most every 3 minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [geckoPool(), geckoPool({ address: POOL_A, dex: 'uniswap-v4-base' })] }) });
    vi.stubGlobal('fetch', fetchMock);
    const redis = fakeRedis();
    const service = newService(redis);

    expect(await service.enqueueFromGeckoTerminal()).toEqual({ geckoTerminalCandidates: 1 });
    const queued = JSON.parse(redis._hashes.get('pool-discovery:pending:eip155:8453')!.get(POOL_B.toLowerCase())!);
    // '0xbbbb…' sorts before '0xusdc…', so the unknown token is token0, as in the real pool.
    expect(queued).toMatchObject({ token0: UNKNOWN_TOKEN_B, token1: USDC, knownSide: 'token1', source: 'geckoterminal' });

    await service.enqueueFromGeckoTerminal();
    expect(fetchMock).toHaveBeenCalledTimes(2); // trending + new, once — the second call was inside the window
  });

  it('skips a pool Kamby already tracks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [geckoPool()] }) }));
    mockPrisma.tokenMarket.findFirst.mockResolvedValue({ id: 'already-tracked' });

    expect(await newService(fakeRedis()).enqueueFromGeckoTerminal()).toEqual({ geckoTerminalCandidates: 0 });
  });
});

describe('PoolDiscoveryService.checkPendingPools — rotation', () => {
  it('checks GeckoTerminal candidates first, then the least recently checked, instead of the same first 10 forever', async () => {
    vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState').mockResolvedValue(null); // nothing promotes
    const redis = fakeRedis();
    const key = 'pool-discovery:pending:eip155:8453';
    for (let i = 0; i < 12; i++) {
      await redis.hset(key, `0xpool${i}`, JSON.stringify({ token0: UNKNOWN_TOKEN_A, token1: USDC, fee: 0, knownSide: 'token1', firstSeenAtMs: Date.now(), source: i === 11 ? 'geckoterminal' : 'factory' }));
    }
    const service = newService(redis);
    const checked = () => vi.mocked(UniswapV3PoolReader.prototype.getPoolState).mock.calls.length;

    await service.checkPendingPools();
    expect(checked()).toBe(10);
    const lastChecked = (pool: string) => JSON.parse(redis._hashes.get(key)!.get(pool)!).lastCheckedAtMs as number | undefined;
    expect(lastChecked('0xpool11')).toBeDefined(); // the GeckoTerminal one jumped the queue
    expect(lastChecked('0xpool9')).toBeUndefined(); // never reached in the first pass

    await service.checkPendingPools();
    expect(lastChecked('0xpool9')).toBeDefined(); // the second pass reached what the first skipped
  }, 30_000);
});

describe('PoolDiscoveryService.enqueueFromGeckoTerminal — address casing', () => {
  it('recognizes a tracked quote token even though GeckoTerminal reports it lowercase', async () => {
    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const NEW_TOKEN = '0x1111111111111111111111111111111111111111';
    const pool = {
      attributes: { address: '0x2222222222222222222222222222222222222222', reserve_in_usd: '777776', transactions: { h24: { buyers: 1016, sellers: 1153 } } },
      relationships: {
        base_token: { data: { id: `bsc_${NEW_TOKEN}` } },
        quote_token: { data: { id: `bsc_${WBNB.toLowerCase()}` } },
        dex: { data: { id: 'pancakeswap-v3-bsc' } },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [pool] }) }));
    // Tracked only under its checksummed spelling, exactly like the real tokens table.
    mockPrisma.token.findUnique.mockImplementation(async ({ where }: { where: { chainId_contractAddress: { contractAddress: string } } }) =>
      where.chainId_contractAddress.contractAddress === WBNB ? { id: 'token-wbnb' } : null,
    );
    mockPrisma.tokenMarket.findFirst.mockImplementation(async ({ where }: { where: { tokenId?: string } }) => (where.tokenId === 'token-wbnb' ? { id: 'wbnb-market' } : null));

    const result = await newService(fakeRedis(), { chainIdentifier: 'eip155:56', dex: 'pancakeswap-v3' }).enqueueFromGeckoTerminal();

    expect(result).toEqual({ geckoTerminalCandidates: 1 });
  });
});

describe('PoolDiscoveryService — redundant pools (both sides already tracked)', () => {
  it('drops a queued pool pairing two tokens Kamby already tracks, instead of promoting a duplicate market', async () => {
    // KNOWN_TOKEN is tracked (it has a priced market); USDC is known by definition.
    mockPrisma.token.findUnique.mockImplementation(async ({ where }: { where: { chainId_contractAddress: { contractAddress: string } } }) =>
      where.chainId_contractAddress.contractAddress === KNOWN_TOKEN ? { id: 'token-known' } : null,
    );
    mockPrisma.tokenMarket.findFirst.mockImplementation(async ({ where }: { where: { tokenId?: string } }) => (where.tokenId === 'token-known' ? { id: 'market-known' } : null));
    const getPoolState = vi.spyOn(UniswapV3PoolReader.prototype, 'getPoolState');
    const redis = fakeRedis();
    await redis.hset('pool-discovery:pending:eip155:8453', POOL_A.toLowerCase(), JSON.stringify({ token0: KNOWN_TOKEN, token1: USDC, fee: 3000, knownSide: 'token1', firstSeenAtMs: Date.now() }));

    const result = await newService(redis).checkPendingPools();

    expect(result).toMatchObject({ promoted: 0, expired: 1 });
    expect(redis._hashes.get('pool-discovery:pending:eip155:8453')!.has(POOL_A.toLowerCase())).toBe(false);
    expect(getPoolState).not.toHaveBeenCalled();
  });
});
