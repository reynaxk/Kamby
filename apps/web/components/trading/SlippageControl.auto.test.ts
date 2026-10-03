import { describe, expect, it } from 'vitest';
import { autoSlippageBps } from './SlippageControl';

describe('autoSlippageBps', () => {
  it('starts at 1% and follows ~2x price impact + 0.5%, within 1-5%', () => {
    expect(autoSlippageBps(null)).toBe(100);
    expect(autoSlippageBps(5)).toBe(100); // liquid coin: floor
    expect(autoSlippageBps(100)).toBe(250); // 1% impact -> 2.5%
    expect(autoSlippageBps(900)).toBe(500); // thin coin: capped at 5%
  });
});
