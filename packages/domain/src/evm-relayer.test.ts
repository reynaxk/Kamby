import { describe, expect, it } from 'vitest';
import { buildRelayedSwapTypedData, parseRelayedSwapTypedDataWire, RELAYED_SWAP_TYPED_DATA_TYPES, RelayedSwapTypedDataWireSchema, toWireTypedData } from './evm-relayer';

describe('buildRelayedSwapTypedData', () => {
  const input = {
    quoteId: '11111111-1111-4111-8111-111111111111',
    walletAddress: '0xAbCdEf0123456789aBcDeF0123456789ABCDEF0',
    chainId: 8453,
    relayerAddress: '0xDeADBeeF00000000000000000000000000dEaD',
    unsignedTx: {
      to: '0x2222222222222222222222222222222222222222',
      data: '0xabcdef1234',
      value: '1000000000000000',
    },
    expiresAt: new Date('2026-09-18T12:00:00.000Z'),
  };

  it('produces the exact, golden-value typed-data object for a fixed input — field order and type matter for the underlying EIP-712 hash, so a future reorder must not silently change what old signatures verify against', () => {
    expect(buildRelayedSwapTypedData(input)).toEqual({
      domain: {
        name: 'Kamby',
        version: '1',
        chainId: 8453,
        verifyingContract: '0xdeadbeef00000000000000000000000000dead',
      },
      types: {
        RelayedSwap: [
          { name: 'quoteId', type: 'string' },
          { name: 'wallet', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'chainId', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
        ],
      },
      primaryType: 'RelayedSwap',
      message: {
        quoteId: '11111111-1111-4111-8111-111111111111',
        wallet: '0xabcdef0123456789abcdef0123456789abcdef0',
        to: '0x2222222222222222222222222222222222222222',
        data: '0xabcdef1234',
        value: 1_000_000_000_000_000n,
        chainId: 8453n,
        expiry: 1789732800n,
      },
    });
  });

  it('lower-cases wallet, to, and verifyingContract — normalizeEvmAddress\'s own convention, so the same address in any input casing produces an identical signable object', () => {
    const upperCased = { ...input, walletAddress: input.walletAddress.toUpperCase(), unsignedTx: { ...input.unsignedTx } };
    expect(buildRelayedSwapTypedData(upperCased).message.wallet).toBe(buildRelayedSwapTypedData(input).message.wallet);
  });

  it('is deterministic — the same input always produces byte-for-byte the same object, the property the quote-response and verification paths both depend on to never drift apart', () => {
    expect(buildRelayedSwapTypedData(input)).toEqual(buildRelayedSwapTypedData({ ...input }));
  });

  it('converts value/chainId/expiry to bigint (uint256), never a string or JS number that could silently lose precision', () => {
    const result = buildRelayedSwapTypedData(input);
    expect(typeof result.message.value).toBe('bigint');
    expect(typeof result.message.chainId).toBe('bigint');
    expect(typeof result.message.expiry).toBe('bigint');
  });

  it('leaves data untouched (already a 0x-prefixed hex string, not an address that needs normalizing)', () => {
    expect(buildRelayedSwapTypedData(input).message.data).toBe('0xabcdef1234');
  });

  it('exports the exact same types object used internally — callers that need to render or re-derive the schema never hand-copy it', () => {
    expect(buildRelayedSwapTypedData(input).types).toBe(RELAYED_SWAP_TYPED_DATA_TYPES);
  });
});

describe('toWireTypedData / parseRelayedSwapTypedDataWire', () => {
  const input = {
    quoteId: '11111111-1111-4111-8111-111111111111',
    walletAddress: '0xAbCdEf0123456789aBcDeF0123456789ABCDEF0',
    chainId: 8453,
    relayerAddress: '0xDeADBeeF00000000000000000000000000dEaD',
    unsignedTx: { to: '0x2222222222222222222222222222222222222222', data: '0xabcdef1234', value: '1000000000000000' },
    expiresAt: new Date('2026-09-18T12:00:00.000Z'),
  };

  it('converts every uint256 field to a decimal string — bigint cannot survive JSON.stringify at all', () => {
    const wire = toWireTypedData(buildRelayedSwapTypedData(input));

    expect(wire.message.value).toBe('1000000000000000');
    expect(wire.message.chainId).toBe('8453');
    expect(wire.message.expiry).toBe('1789732800');
    expect(() => JSON.stringify(wire)).not.toThrow();
  });

  it('round-trips through JSON without losing precision on a real, large uint256 value', () => {
    const largeValueInput = { ...input, unsignedTx: { ...input.unsignedTx, value: '123456789012345678901234567890' } };
    const wire = toWireTypedData(buildRelayedSwapTypedData(largeValueInput));
    const roundTripped = JSON.parse(JSON.stringify(wire));

    expect(parseRelayedSwapTypedDataWire(roundTripped).message.value).toBe(123456789012345678901234567890n);
  });

  it('parseRelayedSwapTypedDataWire is the exact inverse of toWireTypedData — bigint in, bigint out, byte-for-byte', () => {
    const original = buildRelayedSwapTypedData(input);

    expect(parseRelayedSwapTypedDataWire(toWireTypedData(original))).toEqual(original);
  });

  it('the wire form validates against RelayedSwapTypedDataWireSchema — the exact shape crossing the /trade/quote response boundary', () => {
    const wire = toWireTypedData(buildRelayedSwapTypedData(input));

    expect(RelayedSwapTypedDataWireSchema.safeParse(wire).success).toBe(true);
  });

  it('the schema rejects a message carrying a real bigint instead of a string — catches exactly the mistake this whole wire/internal split exists to prevent', () => {
    const withBigint = { ...toWireTypedData(buildRelayedSwapTypedData(input)), message: { ...toWireTypedData(buildRelayedSwapTypedData(input)).message, value: 1n as unknown as string } };

    expect(RelayedSwapTypedDataWireSchema.safeParse(withBigint).success).toBe(false);
  });
});
