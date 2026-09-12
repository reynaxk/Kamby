import { describe, expect, it } from 'vitest';
import { EvmChainDataProvider } from './evm-adapter';

describe('EvmChainDataProvider', () => {
  const chain = { identifier: 'eip155:8453', name: 'Base', nativeSymbol: 'ETH' };

  it('exposes the chain descriptor it was configured with', () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    expect(provider.chain).toEqual(chain);
  });

  it('reports unhealthy rather than throwing when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(provider.isHealthy()).resolves.toBe(false);
  });

  it(
    'returns nulls instead of fabricating token metadata when the RPC is unreachable',
    async () => {
      const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
      await expect(
        provider.getTokenMetadata('0x1234567890123456789012345678901234567890'),
      ).resolves.toEqual({ symbol: null, name: null, decimals: null });
    },
    // Each of the 3 metadata fields now retries independently AND sequentially (see
    // retryRpcCall in getTokenMetadata — reads are awaited one at a time, not fired via
    // Promise.all/allSettled, to avoid bursting a rate-limited RPC) before giving up — a
    // deliberate, real slowdown for "genuinely unreachable," not a flake. Observed ~11.6s
    // against an unreachable host; the default 5s timeout is far too tight for that now.
    25_000,
  );

  it('returns null instead of fabricating transaction details when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(provider.getTransactionDetails(`0x${'1'.repeat(64)}`)).resolves.toBeNull();
  });

  it('returns null instead of fabricating a confirmation count when the RPC is unreachable', async () => {
    const provider = new EvmChainDataProvider({ chain, rpcUrl: 'http://127.0.0.1:0' });
    await expect(provider.getConfirmationCount(`0x${'1'.repeat(64)}`)).resolves.toBeNull();
  });
});
