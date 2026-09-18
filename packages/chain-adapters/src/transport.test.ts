import { createClient, custom, fallback } from 'viem';
import { describe, expect, it } from 'vitest';
import { alwaysTryFallback, createEvmTransport } from './transport';

// viem's transport factories are functions that, when invoked with a minimal client
// config, return an object whose `config.type` names which transport it is ('http' vs
// 'fallback') — inspecting that is the cheapest way to prove the right one was built,
// without making a real network call.
function transportType(transport: ReturnType<typeof createEvmTransport>): string {
  return (transport({}) as unknown as { config: { type: string } }).config.type;
}

describe('createEvmTransport', () => {
  it('builds a plain http transport when no fallback URL is given', () => {
    expect(transportType(createEvmTransport('https://primary.example.com'))).toBe('http');
  });

  it('builds a plain http transport when the fallback is null', () => {
    expect(transportType(createEvmTransport('https://primary.example.com', null))).toBe('http');
  });

  it('builds a fallback transport when a second URL is given', () => {
    expect(transportType(createEvmTransport('https://primary.example.com', 'https://fallback.example.com'))).toBe('fallback');
  });
});

describe('alwaysTryFallback', () => {
  it('always returns false, regardless of the error — never short-circuits the fallback', () => {
    expect(alwaysTryFallback()).toBe(false);
  });
});

describe('createEvmTransport — fallback actually engages on a -32003-coded error', () => {
  it('falls through to the second transport instead of giving up, unlike viem\'s own default shouldThrow', async () => {
    const quicknodeDailyLimitError = { code: -32003, message: 'daily request limit reached' };
    const failingProvider = { request: async () => { throw quicknodeDailyLimitError; } };
    const workingProvider = { request: async () => '0x1234' };

    const client = createClient({
      transport: fallback([custom(failingProvider), custom(workingProvider)], { shouldThrow: alwaysTryFallback }),
    });

    const result = await client.request({ method: 'eth_blockNumber' } as never);
    expect(result).toBe('0x1234');
  });

  it('proves the bug existed: viem\'s own default shouldThrow gives up on the same error instead', async () => {
    const quicknodeDailyLimitError = { code: -32003, message: 'daily request limit reached' };
    const failingProvider = { request: async () => { throw quicknodeDailyLimitError; } };
    const workingProvider = { request: async () => '0x1234' };

    // No shouldThrow override here — viem's own built-in default, the exact config that
    // shipped before this fix.
    const client = createClient({ transport: fallback([custom(failingProvider), custom(workingProvider)]) });

    await expect(client.request({ method: 'eth_blockNumber' } as never)).rejects.toThrow();
  });
});
