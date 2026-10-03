import { describe, expect, it } from 'vitest';
import { decodeBondingCurve } from './pumpfun-curve-refresher';

describe('decodeBondingCurve', () => {
  it('reads the five reserve fields and the complete flag after the 8-byte discriminator', () => {
    const buf = Buffer.alloc(8 + 5 * 8 + 1 + 32);
    [1_073_000_000_000_000n, 30_000_000_000n, 793_100_000_000_000n, 42_500_000_000n, 1_000_000_000_000_000n].forEach((v, i) => buf.writeBigUInt64LE(v, 8 + i * 8));
    buf[48] = 1;
    expect(decodeBondingCurve(buf)).toEqual({
      virtualTokenReserves: '1073000000000000',
      virtualSolReserves: '30000000000',
      realTokenReserves: '793100000000000',
      realSolReserves: '42500000000',
      tokenTotalSupply: '1000000000000000',
      complete: true,
    });
  });
  it('rejects a too-short account', () => {
    expect(decodeBondingCurve(Buffer.alloc(20))).toBeNull();
  });
});
