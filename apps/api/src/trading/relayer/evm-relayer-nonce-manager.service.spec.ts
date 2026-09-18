import { EvmRelayerNonceManagerService } from './evm-relayer-nonce-manager.service';

/** Resolves on the next macrotask — enough to let a real `await` inside `fn` actually
 *  yield, so two concurrent `runExclusive` calls have a genuine chance to overlap if the
 *  serialization were broken, rather than the test passing by accident because everything
 *  ran synchronously. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('EvmRelayerNonceManagerService', () => {
  it('serializes concurrent calls on the same chain — never two fn bodies running at once', async () => {
    const service = new EvmRelayerNonceManagerService();
    let active = 0;
    let sawOverlap = false;
    const order: number[] = [];

    async function slot(n: number) {
      return service.runExclusive('base', async () => {
        active++;
        if (active > 1) sawOverlap = true;
        await tick(5);
        order.push(n);
        active--;
        return n;
      });
    }

    const results = await Promise.all([slot(1), slot(2), slot(3)]);

    expect(sawOverlap).toBe(false);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('runs calls for different chains fully concurrently — one chain never waits on another', async () => {
    const service = new EvmRelayerNonceManagerService();
    let baseActive = 0;
    let arbitrumActive = 0;
    let sawConcurrentAcrossChains = false;

    const basePromise = service.runExclusive('base', async () => {
      baseActive++;
      await tick(20);
      if (arbitrumActive > 0) sawConcurrentAcrossChains = true;
      baseActive--;
    });
    const arbitrumPromise = service.runExclusive('arbitrum', async () => {
      arbitrumActive++;
      await tick(20);
      if (baseActive > 0) sawConcurrentAcrossChains = true;
      arbitrumActive--;
    });

    await Promise.all([basePromise, arbitrumPromise]);

    expect(sawConcurrentAcrossChains).toBe(true);
  });

  it("a failing fn rejects only its own caller — it never jams the queue for later callers on the same chain", async () => {
    const service = new EvmRelayerNonceManagerService();

    const failing = service.runExclusive('base', async () => {
      throw new Error('simulated broadcast failure');
    });
    const after = service.runExclusive('base', async () => 'still runs');

    await expect(failing).rejects.toThrow('simulated broadcast failure');
    await expect(after).resolves.toBe('still runs');
  });

  it('preserves strict submission order even when an earlier call fails', async () => {
    const service = new EvmRelayerNonceManagerService();
    const order: string[] = [];

    const first = service.runExclusive('base', async () => {
      await tick(5);
      order.push('first');
      throw new Error('first failed');
    });
    const second = service.runExclusive('base', async () => {
      order.push('second');
    });

    await expect(first).rejects.toThrow('first failed');
    await second;

    expect(order).toEqual(['first', 'second']);
  });

  it('returns each caller its own value, never a mixed-up result from a different caller', async () => {
    const service = new EvmRelayerNonceManagerService();

    const [a, b] = await Promise.all([
      service.runExclusive('base', async () => {
        await tick(5);
        return { nonce: 1 };
      }),
      service.runExclusive('base', async () => {
        await tick(1);
        return { nonce: 2 };
      }),
    ]);

    expect(a).toEqual({ nonce: 1 });
    expect(b).toEqual({ nonce: 2 });
  });
});
