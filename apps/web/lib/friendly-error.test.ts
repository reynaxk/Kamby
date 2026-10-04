import { describe, expect, it } from 'vitest';
import { friendlyError } from './friendly-error';

describe('friendlyError', () => {
  it('turns wallet library dumps into one plain sentence', () => {
    const viem = new Error('User rejected the request.\n\nRequest Arguments:\n  from: 0x1234567890abcdef1234567890abcdef12345678\n\nVersion: viem@2.21.0');
    expect(friendlyError(viem)).toBe('You cancelled this in your wallet — nothing was sent.');
    expect(friendlyError(new Error('Failed to get a quote (500)'))).toBe('Something went wrong on our side — please try again in a moment.');
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe('Connection problem — check your internet and try again.');
    expect(friendlyError(new Error('Transaction simulation failed: Blockhash not found'))).toMatch(/expired — nothing was charged/);
  });

  it("keeps the API's own human messages, and hides anything code-like", () => {
    expect(friendlyError(new Error('Minimum trade size is $2.00'))).toBe('Minimum trade size is $2.00');
    expect(friendlyError(new Error('Cannot read properties of undefined (reading "x")'))).toBe('Something went wrong — please try again.');
    expect(friendlyError({ weird: true })).toBe('Something went wrong — please try again.');
  });
});
