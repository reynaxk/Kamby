import { describe, expect, it } from 'vitest';
import { isEvmAddress, isValidUsername, normalizeEvmAddress, normalizeUsername } from './wallet';

describe('isEvmAddress', () => {
  it('accepts a well-formed 0x + 40 hex char address', () => {
    expect(isEvmAddress('0x4200000000000000000000000000000000000006')).toBe(true);
  });

  it('accepts mixed-case (checksummed) hex digits', () => {
    expect(isEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(true);
  });

  it('rejects an address missing the 0x prefix', () => {
    expect(isEvmAddress('4200000000000000000000000000000000000006')).toBe(false);
  });

  it('rejects an address with too few hex characters', () => {
    expect(isEvmAddress('0x000000000000000000000000000000000000dEaD'.slice(0, -1))).toBe(false);
  });

  it('rejects an address with too many hex characters', () => {
    expect(isEvmAddress('0x000000000000000000000000000000000000dEaD0')).toBe(false);
  });

  it('rejects a non-hex string', () => {
    expect(isEvmAddress('0xnotAnAddressGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isEvmAddress('')).toBe(false);
  });
});

describe('normalizeEvmAddress', () => {
  it('lowercases a mixed-case address', () => {
    expect(normalizeEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    );
  });

  it('is idempotent on an already-lowercase address', () => {
    const lower = '0x4200000000000000000000000000000000000006';
    expect(normalizeEvmAddress(lower)).toBe(lower);
  });
});

describe('normalizeUsername', () => {
  it('lowercases a mixed-case username', () => {
    expect(normalizeUsername('Alice')).toBe('alice');
  });
});

describe('isValidUsername', () => {
  it('accepts a well-formed username', () => {
    expect(isValidUsername('trader_99')).toBe(true);
  });

  it('accepts a mixed-case username (validated after normalizing, same as storage)', () => {
    expect(isValidUsername('Alice')).toBe(true);
  });

  it('rejects a username shorter than the minimum', () => {
    expect(isValidUsername('ab')).toBe(false);
  });

  it('rejects a username longer than the maximum', () => {
    expect(isValidUsername('a'.repeat(21))).toBe(false);
  });

  it('accepts exactly at the min and max length boundaries', () => {
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('a'.repeat(20))).toBe(true);
  });

  it('rejects a username with disallowed characters', () => {
    expect(isValidUsername('trader-99')).toBe(false); // hyphen not allowed
    expect(isValidUsername('trader 99')).toBe(false); // space not allowed
    expect(isValidUsername('trader.99')).toBe(false); // dot not allowed
    expect(isValidUsername('trader😀')).toBe(false); // emoji not allowed
  });

  it('rejects a reserved/impersonation-prone name, case-insensitively', () => {
    expect(isValidUsername('kamby')).toBe(false);
    expect(isValidUsername('Admin')).toBe(false);
    expect(isValidUsername('SUPPORT')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidUsername('')).toBe(false);
  });
});
