import { describe, expect, it } from 'vitest';
import { autoSlippageBps, nextAutoSlippageBps } from './SlippageControl';

describe('autoSlippageBps', () => {
  it('starts at 1% and follows ~2x price impact + 0.5%, within 1-5%', () => {
    expect(autoSlippageBps(null)).toBe(100);
    expect(autoSlippageBps(5)).toBe(100); // liquid coin: floor
    expect(autoSlippageBps(100)).toBe(250); // 1% impact -> 2.5%
    expect(autoSlippageBps(900)).toBe(500); // thin coin: capped at 5%
  });
});

describe('nextAutoSlippageBps', () => {
  it('only widens, and only by a real step — a jittering price impact never re-quotes again', () => {
    expect(nextAutoSlippageBps(100, 110)).toBe(100);
    expect(nextAutoSlippageBps(350, 340)).toBe(350);
    expect(nextAutoSlippageBps(350, 360)).toBe(350);
    expect(nextAutoSlippageBps(100, 450)).toBe(450);
  });
});
