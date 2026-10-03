import { setupFeeUsdcRaw } from './new-coin-setup-fee';

describe('setupFeeUsdcRaw', () => {
  it('charges the token-account rent in USDC, rounded up to the cent', () => {
    // 0.00203928 SOL at $150 = $0.3058… → $0.31
    expect(setupFeeUsdcRaw(2_039_280n, 150)).toBe(310_000n);
  });
  it('never charges less than $0.10', () => {
    expect(setupFeeUsdcRaw(2_039_280n, 20)).toBe(100_000n);
  });
});
