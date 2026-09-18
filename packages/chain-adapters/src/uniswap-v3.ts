import { createPublicClient, type PublicClient } from 'viem';
import { erc20ExtraAbi, uniswapV3PoolAbi, uniswapV3SwapEvent } from './uniswap-v3-abi';
import { retryRpcCall } from './retry';
import { createEvmTransport } from './transport';

export interface UniswapV3ReaderConfig {
  rpcUrl: string;
  /** Optional second endpoint — see createEvmTransport's own doc comment. */
  rpcUrlFallback?: string | null;
}

export interface PoolState {
  token0: string;
  token1: string;
  feeTier: number;
  sqrtPriceX96: bigint;
  tick: number;
}

export interface DecodedSwapEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  /** Whichever address called the pool's `swap()` — usually a router contract, not the
   *  end user. Null only if the log's indexed topic somehow failed to decode (should not
   *  happen for a real Swap log) — never a fabricated address. See
   *  docs/SOCIAL.md#trader-identity. */
  sender: string | null;
  /** The address that received this swap's output tokens — used as the trader identity
   *  for this swap. Same null-on-decode-failure rule as sender. See
   *  docs/SOCIAL.md#trader-identity. */
  recipient: string | null;
}

/**
 * Reads Uniswap-V3-style pools directly — the only place in the codebase that knows this
 * protocol's ABI. A future chain/DEX combination gets its own reader implementing the same
 * shape; nothing outside `packages/chain-adapters` should import `uniswap-v3-abi.ts`
 * directly. See docs/CHAIN_ADAPTERS.md.
 *
 * Every method returns `null` on failure rather than throwing through to the caller for
 * anything short of a configuration error — ingestion is expected to skip a market for one
 * tick rather than crash the worker over a single bad RPC response. `getSwapEvents` is the
 * one method where failure and "genuinely found nothing" must stay distinguishable, so its
 * empty-but-successful result is `[]`, never conflated with the `null` failure case.
 */
export class UniswapV3PoolReader {
  private readonly client: PublicClient;

  constructor(config: UniswapV3ReaderConfig) {
    this.client = createPublicClient({ transport: createEvmTransport(config.rpcUrl, config.rpcUrlFallback) });
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockTimestamp(blockNumber: bigint): Promise<Date | null> {
    try {
      const block = await this.client.getBlock({ blockNumber });
      return new Date(Number(block.timestamp) * 1000);
    } catch {
      return null;
    }
  }

  /**
   * All four reads retried together as one unit (see `retryRpcCall`) rather than
   * individually — unlike `getTokenMetadata`'s per-field independence, a pool's state is
   * only meaningful as a whole, so there's no value in one field succeeding while another
   * doesn't. Issued one at a time (awaited in sequence) rather than via `Promise.all`'s
   * simultaneous kickoff: a burst of 4 parallel requests is exactly what trips a per-burst
   * rate limit on a shared free RPC (confirmed in production against the public Base
   * endpoint — concurrent reads for one pool came back "over rate limit" while the same
   * calls issued sequentially succeeded). This keeps at most one request in flight at a
   * time; the whole sequence still gets a few quick retry attempts before actually giving
   * up for this tick.
   */
  async getPoolState(poolAddress: string): Promise<PoolState | null> {
    const address = poolAddress as `0x${string}`;
    try {
      const [slot0, token0, token1, fee] = await retryRpcCall(async () => {
        const slot0Result = await this.client.readContract({ address, abi: uniswapV3PoolAbi, functionName: 'slot0' });
        const token0Result = await this.client.readContract({ address, abi: uniswapV3PoolAbi, functionName: 'token0' });
        const token1Result = await this.client.readContract({ address, abi: uniswapV3PoolAbi, functionName: 'token1' });
        const feeResult = await this.client.readContract({ address, abi: uniswapV3PoolAbi, functionName: 'fee' });
        return [slot0Result, token0Result, token1Result, feeResult] as const;
      });
      const [sqrtPriceX96, tick] = slot0;
      if (sqrtPriceX96 <= 0n) return null; // uninitialized pool — nothing honest to report
      return { token0, token1, feeTier: fee, sqrtPriceX96, tick };
    } catch {
      return null;
    }
  }

  async getTokenBalance(tokenAddress: string, holder: string): Promise<bigint | null> {
    try {
      return await this.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20ExtraAbi,
        functionName: 'balanceOf',
        args: [holder as `0x${string}`],
      });
    } catch {
      return null;
    }
  }

  async getTotalSupply(tokenAddress: string): Promise<bigint | null> {
    try {
      return await this.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20ExtraAbi,
        functionName: 'totalSupply',
      });
    } catch {
      return null;
    }
  }

  /**
   * Fetches Swap events for `poolAddress` in [fromBlock, toBlock]. The caller is
   * responsible for keeping the range within what the configured RPC will accept in one
   * request (observed ~10,000 blocks on public Base RPC before requests start failing) —
   * see the chunking in apps/workers/src/market/ingestion.ts.
   *
   * Returns `null` on an RPC failure — deliberately distinct from `[]`, which means the
   * query succeeded and genuinely found no Swap events in that range. Callers must treat
   * `null` as "this range was not observed" and must not advance a persisted cursor past
   * it: collapsing the two into a bare `[]` would make a transient RPC error look like a
   * quiet block, and ingestion would silently and permanently skip real swaps.
   */
  async getSwapEvents(poolAddress: string, fromBlock: bigint, toBlock: bigint): Promise<DecodedSwapEvent[] | null> {
    try {
      const logs = await this.client.getLogs({
        address: poolAddress as `0x${string}`,
        event: uniswapV3SwapEvent,
        fromBlock,
        toBlock,
      });
      return logs.map((log) => ({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        amount0: log.args.amount0 ?? 0n,
        amount1: log.args.amount1 ?? 0n,
        sqrtPriceX96: log.args.sqrtPriceX96 ?? 0n,
        sender: log.args.sender ?? null,
        recipient: log.args.recipient ?? null,
      }));
    } catch {
      return null;
    }
  }
}
