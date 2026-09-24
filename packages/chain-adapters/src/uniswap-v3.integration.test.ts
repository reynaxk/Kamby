import { describe, expect, it } from 'vitest';
import { UniswapV3PoolReader } from './uniswap-v3';

/**
 * Runs against the real Base mainnet public RPC and the real, live WETH/USDC Uniswap V3
 * pool — the same one verified by hand during development (see docs/MARKET_DATA.md).
 * Deliberately not mocked: this is the one place that proves the ABI decoding and RPC
 * plumbing actually work against a real contract, not just a fixture we wrote ourselves.
 * Needs outbound network access; skip locally with `--exclude` if you're offline.
 */
const RPC_URL = 'https://mainnet.base.org';
const WETH_USDC_POOL = '0x6c561B446416E1A00E8E93E221854d6eA4171372';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** Base's real Uniswap V3 Factory — deliberately NOT the same address as Ethereum
 *  mainnet's (0x1F98431c8aD98523631AE4a59f267346ea31F984), confirmed by hand 2026-09-24:
 *  that address has no PoolCreated events on Base at all, while this one's
 *  `getPool(WETH, USDC, 3000)` resolves to exactly WETH_USDC_POOL above. See
 *  pool-discovery.ts's own doc comment for why this mattered. */
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

describe('UniswapV3PoolReader (live Base mainnet)', () => {
  it('reads real pool state with the expected tokens and fee tier', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const state = await reader.getPoolState(WETH_USDC_POOL);

    expect(state).not.toBeNull();
    expect(state!.token0.toLowerCase()).toBe(WETH.toLowerCase());
    expect(state!.token1.toLowerCase()).toBe(USDC.toLowerCase());
    expect(state!.feeTier).toBe(3000);
    expect(state!.sqrtPriceX96).toBeGreaterThan(0n);
  }, 20_000);

  it('reads a real, positive token balance held by the pool', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const balance = await reader.getTokenBalance(USDC, WETH_USDC_POOL);

    expect(balance).not.toBeNull();
    expect(balance!).toBeGreaterThan(0n);
  }, 20_000);

  it('returns null instead of throwing for a nonexistent pool address', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const state = await reader.getPoolState('0x0000000000000000000000000000000000000001');
    expect(state).toBeNull();
  }, 20_000);

  it('reads real recent Swap events with sane decoded fields', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const latest = await reader.getLatestBlockNumber();
    const events = await reader.getSwapEvents(WETH_USDC_POOL, latest - 2000n, latest);

    // This pool trades constantly; a 2000-block window (~1hr) should never come back
    // null (RPC failure) or empty, but if it's somehow empty, assert the honest
    // empty-array contract rather than force a length.
    expect(events).not.toBeNull();
    for (const event of events!) {
      expect(event.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(event.sqrtPriceX96).toBeGreaterThan(0n);
      // Exactly one side of a swap is positive (paid into the pool), the other negative.
      expect(event.amount0 > 0n !== event.amount1 > 0n).toBe(true);
      // Phase 2 trader identity: both indexed addresses decode off a real Swap log.
      expect(event.sender).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(event.recipient).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  }, 30_000);

  it('returns a real empty array — not null — for a range with genuinely no Swap events', async () => {
    // Base's very first blocks, long before this pool existed: a legitimate zero-result
    // eth_getLogs query, which must come back `[]` (success) rather than `null` (failure).
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const events = await reader.getSwapEvents(WETH_USDC_POOL, 1n, 2n);
    expect(events).toEqual([]);
  }, 20_000);

  it('returns null, not [], when eth_getLogs itself fails', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0' });
    const events = await reader.getSwapEvents(WETH_USDC_POOL, 1n, 2n);
    expect(events).toBeNull();
  }, 20_000);

  it('reads real PoolCreated events from the Factory with sane decoded fields', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const latest = await reader.getLatestBlockNumber();
    // 2000n, not wider: the public Base RPC's real current eth_getLogs cap, confirmed by
    // hand 2026-09-24 ("eth_getLogs is limited to a 2,000 range") — a genuinely different,
    // lower figure than the ~10,000 this file's own getSwapEvents doc comment cites, which
    // is why pool-discovery.ts deliberately reuses the same conservative 150-block
    // MAX_BLOCKS_PER_TICK chunk size ingestion.ts already uses, not this test's wider probe.
    // A real new pool doesn't land in every possible 2000-block window, so this only
    // asserts the query succeeds and whatever it finds decodes sanely — never a nonzero
    // count, which would make this test flaky.
    const events = await reader.getPoolCreatedEvents(FACTORY, latest - 2000n, latest);

    expect(events).not.toBeNull();
    for (const event of events!) {
      expect(event.token0).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(event.token1).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(event.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect([100, 500, 3000, 10000]).toContain(event.fee); // real Uniswap V3 fee tiers only
      expect(event.blockNumber).toBeGreaterThan(0n);
    }
  }, 30_000);

  it('returns a real empty array for a range before the Factory existed on Base', async () => {
    const reader = new UniswapV3PoolReader({ rpcUrl: RPC_URL });
    const events = await reader.getPoolCreatedEvents(FACTORY, 1n, 2n);
    expect(events).toEqual([]);
  }, 20_000);
});
