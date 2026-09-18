import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { COMPLETE_EVENT_DISCRIMINATOR, CREATE_EVENT_DISCRIMINATOR, TRADE_EVENT_DISCRIMINATOR } from './pumpfun-constants';
import { decodeCompleteEvent, decodeCreateEvent, decodeTradeEvent, extractProgramDataPayloads } from './pumpfun-event-decoder';

// Hand-rolled Borsh encoders, independent of the decoder under test — this test file
// deliberately doesn't import any encoding helper from pumpfun-event-decoder.ts itself, so
// it can't pass merely by being self-consistent with a shared bug.
function u64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}
function i64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}
function borshString(value: string): Buffer {
  const utf8 = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length);
  return Buffer.concat([len, utf8]);
}
function bool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

const MINT = Keypair.generate().publicKey;
const BONDING_CURVE = Keypair.generate().publicKey;
const USER = Keypair.generate().publicKey;
const CREATOR = Keypair.generate().publicKey;

describe('decodeCreateEvent', () => {
  it('decodes a real, correctly-shaped CreateEvent buffer', () => {
    const buf = Buffer.concat([
      CREATE_EVENT_DISCRIMINATOR,
      borshString('TestCoin'),
      borshString('TEST'),
      borshString('https://example.com/metadata.json'),
      MINT.toBuffer(),
      BONDING_CURVE.toBuffer(),
      USER.toBuffer(),
      CREATOR.toBuffer(),
      i64(1_700_000_000n), // timestamp
      u64(1_073_000_000_000_000n), // virtual_token_reserves
      u64(30_000_000_000n), // virtual_sol_reserves
      u64(793_100_000_000_000n), // real_token_reserves
      u64(1_000_000_000_000_000n), // token_total_supply
      // Deliberately followed by more real-shaped fields (token_program pubkey,
      // is_mayhem_mode bool, ...) the decoder never reads — proves it stops where it says
      // it does, not that it happens to work only on a truncated buffer.
      Keypair.generate().publicKey.toBuffer(),
      bool(false),
    ]);

    const result = decodeCreateEvent(buf);

    expect(result).toEqual({
      name: 'TestCoin',
      symbol: 'TEST',
      uri: 'https://example.com/metadata.json',
      mint: MINT.toBase58(),
      bondingCurve: BONDING_CURVE.toBase58(),
      creator: CREATOR.toBase58(),
      virtualTokenReserves: '1073000000000000',
      virtualSolReserves: '30000000000',
      realTokenReserves: '793100000000000',
      tokenTotalSupply: '1000000000000000',
    });
  });

  it('returns null for a buffer with the wrong discriminator (not a CreateEvent)', () => {
    const buf = Buffer.concat([TRADE_EVENT_DISCRIMINATOR, Buffer.alloc(100)]);
    expect(decodeCreateEvent(buf)).toBeNull();
  });

  it('returns null, never throws, for a truncated buffer', () => {
    const buf = Buffer.concat([CREATE_EVENT_DISCRIMINATOR, borshString('Truncated')]);
    expect(decodeCreateEvent(buf)).toBeNull();
  });
});

describe('decodeTradeEvent', () => {
  it('decodes a real, correctly-shaped buy TradeEvent buffer', () => {
    const buf = Buffer.concat([
      TRADE_EVENT_DISCRIMINATOR,
      MINT.toBuffer(),
      u64(1_000_000_000n), // sol_amount
      u64(5_000_000_000n), // token_amount
      bool(true), // is_buy
      USER.toBuffer(),
      i64(1_700_000_100n), // timestamp
      u64(31_000_000_000n), // virtual_sol_reserves
      u64(1_068_000_000_000_000n), // virtual_token_reserves
      u64(1_000_000_000n), // real_sol_reserves
      u64(788_100_000_000_000n), // real_token_reserves
      // Followed by fee_recipient pubkey and beyond — never read.
      Keypair.generate().publicKey.toBuffer(),
      u64(100n),
    ]);

    const result = decodeTradeEvent(buf);

    expect(result).toEqual({
      mint: MINT.toBase58(),
      isBuy: true,
      virtualSolReserves: '31000000000',
      virtualTokenReserves: '1068000000000000',
      realSolReserves: '1000000000',
      realTokenReserves: '788100000000000',
    });
  });

  it('decodes is_buy=false for a sell', () => {
    const buf = Buffer.concat([
      TRADE_EVENT_DISCRIMINATOR,
      MINT.toBuffer(),
      u64(0n),
      u64(0n),
      bool(false),
      USER.toBuffer(),
      i64(0n),
      u64(0n),
      u64(0n),
      u64(0n),
      u64(0n),
    ]);

    expect(decodeTradeEvent(buf)?.isBuy).toBe(false);
  });

  it('returns null for a non-TradeEvent discriminator', () => {
    expect(decodeTradeEvent(Buffer.concat([CREATE_EVENT_DISCRIMINATOR, Buffer.alloc(100)]))).toBeNull();
  });
});

describe('decodeCompleteEvent', () => {
  it('decodes a real, correctly-shaped CompleteEvent buffer', () => {
    const buf = Buffer.concat([
      COMPLETE_EVENT_DISCRIMINATOR,
      USER.toBuffer(),
      MINT.toBuffer(),
      BONDING_CURVE.toBuffer(),
      i64(1_700_000_200n),
      Keypair.generate().publicKey.toBuffer(), // quote_mint — never read
    ]);

    expect(decodeCompleteEvent(buf)).toEqual({ mint: MINT.toBase58(), bondingCurve: BONDING_CURVE.toBase58() });
  });

  it('returns null for a non-CompleteEvent discriminator', () => {
    expect(decodeCompleteEvent(Buffer.concat([TRADE_EVENT_DISCRIMINATOR, Buffer.alloc(100)]))).toBeNull();
  });
});

describe('extractProgramDataPayloads', () => {
  it('extracts and base64-decodes every "Program data:" log line', () => {
    const payload = Buffer.concat([CREATE_EVENT_DISCRIMINATOR, Buffer.from('hello')]);
    const logs = [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      `Program data: ${payload.toString('base64')}`,
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
    ];

    const result = extractProgramDataPayloads(logs);

    expect(result).toHaveLength(1);
    expect(result[0]?.equals(payload)).toBe(true);
  });

  it('returns an empty array, never throws, when no log carries program data', () => {
    expect(extractProgramDataPayloads(['some unrelated log line'])).toEqual([]);
  });

  it('extracts multiple payloads when a transaction logs more than one event', () => {
    const first = Buffer.from('AAAA', 'base64');
    const second = Buffer.from('BBBB', 'base64');
    const logs = [`Program data: ${first.toString('base64')}`, `Program data: ${second.toString('base64')}`];

    expect(extractProgramDataPayloads(logs)).toHaveLength(2);
  });
});
