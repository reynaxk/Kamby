import { resolveJupiterPlatformFeeBps } from './jupiter-fee-schedule';

describe('resolveJupiterPlatformFeeBps', () => {
  it('charges 100bps for a trade well under $50', () => {
    expect(resolveJupiterPlatformFeeBps(1)).toBe(100);
    expect(resolveJupiterPlatformFeeBps(49)).toBe(100);
    expect(resolveJupiterPlatformFeeBps(49.99)).toBe(100);
  });

  it('charges 75bps at exactly $50 — the $50 boundary belongs to the uncapped tier, not the under-$50 one', () => {
    expect(resolveJupiterPlatformFeeBps(50)).toBe(75);
  });

  it('charges 75bps for a large trade, same rate regardless of size above $50', () => {
    expect(resolveJupiterPlatformFeeBps(500)).toBe(75);
    expect(resolveJupiterPlatformFeeBps(50_000)).toBe(75);
  });

  it('never returns a bps value anywhere near what the old flat-dollar tiers implied', () => {
    // A $1 trade under the (superseded) flat-dollar schedule implied a 2500bps (25%) rate —
    // this function must never produce anything close to that.
    expect(resolveJupiterPlatformFeeBps(1)).toBeLessThan(300);
  });
});
