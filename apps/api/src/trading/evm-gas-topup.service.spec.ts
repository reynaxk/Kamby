import { needsTopup } from './evm-gas-topup.service';

describe('needsTopup', () => {
  const minWei = 10_000_000_000_000n;
  it('tops up a wallet that holds USDC but almost no gas', () => {
    expect(needsTopup(0n, 5_000_000n, 6, minWei)).toBe(true);
  });
  it('never tops up a wallet without at least 1 USDC (no free gas for empty wallets)', () => {
    expect(needsTopup(0n, 999_999n, 6, minWei)).toBe(false);
    expect(needsTopup(0n, 10n ** 17n, 18, minWei)).toBe(false); // 0.1 BNB-chain USDC (18 decimals)
  });
  it('leaves a wallet that already has enough gas alone', () => {
    expect(needsTopup(minWei, 5_000_000n, 6, minWei)).toBe(false);
  });
});
