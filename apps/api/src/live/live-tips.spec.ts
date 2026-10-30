import { liveTipFeeUsd } from '@kamby/domain';
import { toRaw } from './live-tips.service';

describe('live tips', () => {
  it('takes 3% in whole cents', () => {
    expect(liveTipFeeUsd(5)).toBe(0.15);
    expect(liveTipFeeUsd(10)).toBe(0.3);
    expect(liveTipFeeUsd(25)).toBe(0.75);
    expect(liveTipFeeUsd(7.77)).toBe(0.23);
  });

  it('turns dollars into exact token units', () => {
    expect(toRaw(5, 6)).toBe(5_000_000n);
    expect(toRaw(0.15, 6)).toBe(150_000n);
    expect(toRaw(0.29, 18)).toBe(290_000_000_000_000_000n);
  });
});
