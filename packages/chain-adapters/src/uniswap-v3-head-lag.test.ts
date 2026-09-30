import { describe, expect, it, vi } from 'vitest';
import { UniswapV3PoolReader } from './uniswap-v3';

function readerAtHead(head: bigint, headLagBlocks?: number) {
  const reader = new UniswapV3PoolReader({ rpcUrl: 'http://127.0.0.1:0', headLagBlocks });
  vi.spyOn((reader as unknown as { client: { getBlockNumber: () => Promise<bigint> } }).client, 'getBlockNumber').mockResolvedValue(head);
  return reader;
}

describe('UniswapV3PoolReader.getLatestBlockNumber — head lag', () => {
  it('returns the raw head by default', async () => {
    expect(await readerAtHead(1_000n).getLatestBlockNumber()).toBe(1_000n);
  });

  it('stays headLagBlocks behind the reported head', async () => {
    expect(await readerAtHead(1_000n, 10).getLatestBlockNumber()).toBe(990n);
  });

  it('never goes below zero', async () => {
    expect(await readerAtHead(5n, 10).getLatestBlockNumber()).toBe(0n);
  });
});
