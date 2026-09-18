import { PublicKey } from '@solana/web3.js';
import { COMPLETE_EVENT_DISCRIMINATOR, CREATE_EVENT_DISCRIMINATOR, TRADE_EVENT_DISCRIMINATOR } from './pumpfun-constants';

/**
 * Decodes Pump.fun's Anchor `CreateEvent`/`TradeEvent`/`CompleteEvent` log entries — see
 * pumpfun-constants.ts's own doc comment for how the field layout below was verified
 * against the real, current IDL. Anchor emits these via self-CPI logging, surfacing as a
 * `"Program data: <base64>"` line in a transaction's logs; the base64-decoded bytes start
 * with the event's 8-byte discriminator, followed by its Borsh-encoded fields in IDL order.
 *
 * Each decoder reads only the fields this integration actually needs, then stops — not the
 * event's full field list. This is deliberate, not laziness: `TradeEvent` in particular has
 * 34 fields including a variable-length `Vec<Shareholder>` partway through whose own struct
 * layout isn't decoded here; stopping right after the four reserve fields (all fixed-size,
 * all before that vector) avoids needing to parse a structure this integration has no use
 * for. Only the default, SOL-denominated bonding curve is targeted — `quote_mint`-aware
 * multi-quote-token curves (a newer Pump.fun feature) fall outside what's decoded here; see
 * pumpfun-ingestion.ts for how a non-SOL curve is handled once discovered some other way.
 *
 * Every decoder returns `null` on any parse failure (a genuinely malformed log, an
 * unexpected byte length) rather than throwing — a single bad event must never take down
 * the log subscription it arrived on.
 */

export interface DecodedCreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  creator: string;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  tokenTotalSupply: string;
}

export interface DecodedTradeEvent {
  mint: string;
  isBuy: boolean;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
}

export interface DecodedCompleteEvent {
  mint: string;
  bondingCurve: string;
}

/** A small sequential cursor over a Borsh-encoded buffer — deliberately minimal (only the
 *  primitives Pump.fun's events actually use), not a general Borsh library. */
class BorshReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  private require(length: number): void {
    if (this.offset + length > this.buf.length) {
      throw new RangeError(`Borsh read past end of buffer at offset ${this.offset} (need ${length}, have ${this.buf.length - this.offset})`);
    }
  }

  skip(length: number): void {
    this.require(length);
    this.offset += length;
  }

  readU64String(): string {
    this.require(8);
    const value = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value.toString();
  }

  readBool(): boolean {
    this.require(1);
    const value = this.buf.readUInt8(this.offset) !== 0;
    this.offset += 1;
    return value;
  }

  readPubkey(): string {
    this.require(32);
    const bytes = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes).toBase58();
  }

  /** Borsh strings are a u32 LE length prefix followed by that many UTF-8 bytes. */
  readString(): string {
    this.require(4);
    const length = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    this.require(length);
    const value = this.buf.subarray(this.offset, this.offset + length).toString('utf8');
    this.offset += length;
    return value;
  }
}

function matchesDiscriminator(buf: Buffer, discriminator: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(discriminator);
}

export function decodeCreateEvent(buf: Buffer): DecodedCreateEvent | null {
  if (!matchesDiscriminator(buf, CREATE_EVENT_DISCRIMINATOR)) return null;
  try {
    const r = new BorshReader(buf);
    r.skip(8); // discriminator
    const name = r.readString();
    const symbol = r.readString();
    const uri = r.readString();
    const mint = r.readPubkey();
    const bondingCurve = r.readPubkey();
    r.skip(32); // user
    const creator = r.readPubkey();
    r.skip(8); // timestamp
    const virtualTokenReserves = r.readU64String();
    const virtualSolReserves = r.readU64String();
    const realTokenReserves = r.readU64String();
    const tokenTotalSupply = r.readU64String();
    return { name, symbol, uri, mint, bondingCurve, creator, virtualTokenReserves, virtualSolReserves, realTokenReserves, tokenTotalSupply };
  } catch {
    return null;
  }
}

export function decodeTradeEvent(buf: Buffer): DecodedTradeEvent | null {
  if (!matchesDiscriminator(buf, TRADE_EVENT_DISCRIMINATOR)) return null;
  try {
    const r = new BorshReader(buf);
    r.skip(8); // discriminator
    const mint = r.readPubkey();
    r.skip(8); // sol_amount
    r.skip(8); // token_amount
    const isBuy = r.readBool();
    r.skip(32); // user
    r.skip(8); // timestamp
    const virtualSolReserves = r.readU64String();
    const virtualTokenReserves = r.readU64String();
    const realSolReserves = r.readU64String();
    const realTokenReserves = r.readU64String();
    return { mint, isBuy, virtualSolReserves, virtualTokenReserves, realSolReserves, realTokenReserves };
  } catch {
    return null;
  }
}

export function decodeCompleteEvent(buf: Buffer): DecodedCompleteEvent | null {
  if (!matchesDiscriminator(buf, COMPLETE_EVENT_DISCRIMINATOR)) return null;
  try {
    const r = new BorshReader(buf);
    r.skip(8); // discriminator
    r.skip(32); // user
    const mint = r.readPubkey();
    const bondingCurve = r.readPubkey();
    return { mint, bondingCurve };
  } catch {
    return null;
  }
}

/** Extracts every `Program data: <base64>` payload from a transaction's log lines —
 *  Anchor's self-CPI event-logging convention. A log entry can carry more than one; a
 *  transaction that touches Pump.fun multiple times (rare, but not disallowed) can too. */
export function extractProgramDataPayloads(logs: string[]): Buffer[] {
  const prefix = 'Program data: ';
  const payloads: Buffer[] = [];
  for (const line of logs) {
    if (!line.startsWith(prefix)) continue;
    const base64 = line.slice(prefix.length).trim();
    try {
      payloads.push(Buffer.from(base64, 'base64'));
    } catch {
      // A malformed/truncated log line is skipped, never thrown past this point.
    }
  }
  return payloads;
}
