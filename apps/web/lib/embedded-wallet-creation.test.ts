import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmbeddedWalletOnce, resetEmbeddedWalletCreation } from './embedded-wallet-creation';

describe('createEmbeddedWalletOnce', () => {
  beforeEach(() => resetEmbeddedWalletCreation());

  it('runs one creation per chain however many components ask at once', async () => {
    const create = vi.fn().mockResolvedValue({});
    await Promise.all([createEmbeddedWalletOnce('ethereum', create), createEmbeddedWalletOnce('ethereum', create), createEmbeddedWalletOnce('ethereum', create)]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never runs the EVM and Solana creations at the same time', async () => {
    const order: string[] = [];
    let releaseEvm!: () => void;
    const evm = vi.fn(() => new Promise<void>((resolve) => { order.push('evm-start'); releaseEvm = () => { order.push('evm-end'); resolve(); }; }));
    const solana = vi.fn(async () => { order.push('solana-start'); });
    const both = Promise.all([createEmbeddedWalletOnce('ethereum', evm), createEmbeddedWalletOnce('solana', solana)]);
    await vi.waitFor(() => expect(evm).toHaveBeenCalled());
    expect(solana).not.toHaveBeenCalled();
    releaseEvm();
    await both;
    expect(order).toEqual(['evm-start', 'evm-end', 'solana-start']);
  });

  it('does not create again after a success, but does retry after a failure', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('network'));
    await expect(createEmbeddedWalletOnce('solana', failing)).rejects.toThrow('network');
    const working = vi.fn().mockResolvedValue({});
    await createEmbeddedWalletOnce('solana', working);
    await createEmbeddedWalletOnce('solana', working);
    expect(working).toHaveBeenCalledTimes(1);
  });
});
