import { describe, expect, it } from 'vitest';
import { moveAmountUsd, pickSource } from './use-cross-chain-funding';

describe('moveAmountUsd', () => {
  it('moves the shortfall plus a hair for rounding, never below the $0.50 minimum, nothing when covered', () => {
    expect(moveAmountUsd(5, 1.2)).toBe(3.83); // 3.80 short → +0.5% + 1¢, rounded up to the cent
    expect(moveAmountUsd(2, 1.9)).toBe(0.5);
    expect(moveAmountUsd(5, 6)).toBe(0);
  });
});

describe('pickSource', () => {
  it('pulls from the richest other chain that covers the move — never the target itself', () => {
    expect(pickSource('solana', 3, { base: 10, bnb: 20, solana: 0 })).toBe('bnb');
    expect(pickSource('base', 3, { base: 0, bnb: 5, solana: 50 })).toBe('solana');
    expect(pickSource('base', 3, { base: 0, bnb: 1, solana: 2 })).toBeNull();
    expect(pickSource('bnb', 3, { base: 3.01, bnb: 0, solana: 0 })).toBeNull(); // too tight to cover
  });
});
