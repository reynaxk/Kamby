import { SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { SOLANA_USDC_MINT, type EvmChainConfig } from '@kamby/domain';
import { assetsForChain, isValidDestination, SEND_CHAINS } from './send';

const BASE = SEND_CHAINS.find((c) => c.slug === 'base')!;
const BNB = SEND_CHAINS.find((c) => c.slug === 'bnb')!;
const SOLANA = SEND_CHAINS.find((c) => c.slug === 'solana')!;

const EVM_CONFIGS: EvmChainConfig[] = [
  { slug: 'base', chainId: 8453, usdcAddress: '0xbaseusdc' },
  { slug: 'bnb', chainId: 56, usdcAddress: '0xbnbusdc' },
];

describe('assetsForChain', () => {
  it('always lists the native asset first', () => {
    expect(assetsForChain(BASE, EVM_CONFIGS)[0]).toMatchObject({ kind: 'native', symbol: 'ETH' });
    expect(assetsForChain(SOLANA, EVM_CONFIGS)[0]).toMatchObject({ kind: 'native', symbol: 'SOL' });
  });

  it('uses the real, backend-configured USDC address for an EVM chain — never a second, hardcoded one', () => {
    const assets = assetsForChain(BASE, EVM_CONFIGS);
    expect(assets).toContainEqual({ kind: 'token', symbol: 'USDC', address: '0xbaseusdc', decimals: null });
  });

  it('uses the single well-known SOLANA_USDC_MINT for Solana, with its real, fixed decimals', () => {
    const assets = assetsForChain(SOLANA, EVM_CONFIGS);
    expect(assets).toContainEqual({ kind: 'token', symbol: 'USDC', address: SOLANA_USDC_MINT, decimals: 6 });
  });

  it('offers native-only when this deployment has no USDC configured for that chain', () => {
    const assets = assetsForChain(BNB, []); // BNB not in the configured list
    expect(assets).toHaveLength(1);
    expect(assets[0]!.kind).toBe('native');
  });

  it('never assumes an EVM token’s decimals — always null until read live on-chain', () => {
    const assets = assetsForChain(BASE, EVM_CONFIGS);
    const usdc = assets.find((a) => a.symbol === 'USDC');
    expect(usdc?.decimals).toBeNull();
  });
});

describe('isValidDestination', () => {
  // A raw, arbitrary 40-hex-char address, derived programmatically (via viem's own
  // getAddress) rather than a memorized "famous" test vector — self-verifying, not
  // dependent on correctly recalling a real checksum string by hand.
  const RAW_LOWERCASE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

  it('accepts an all-lowercase EVM address (no checksum info to verify, still a real address)', () => {
    expect(isValidDestination('evm', RAW_LOWERCASE_ADDRESS)).toBe(true);
  });

  it('accepts a well-formed, correctly-checksummed EVM address', () => {
    const checksummed = getAddress(RAW_LOWERCASE_ADDRESS);
    expect(isValidDestination('evm', checksummed)).toBe(true);
  });

  it('rejects an EVM address with an invalid mixed-case checksum — a real, catchable typo', () => {
    const checksummed = getAddress(RAW_LOWERCASE_ADDRESS);
    const chars = [...checksummed];
    const idx = chars.findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
    chars[idx] = chars[idx] === chars[idx]!.toUpperCase() ? chars[idx]!.toLowerCase() : chars[idx]!.toUpperCase();
    expect(isValidDestination('evm', chars.join(''))).toBe(false);
  });

  it('rejects a non-address string for EVM', () => {
    expect(isValidDestination('evm', 'not an address')).toBe(false);
    expect(isValidDestination('evm', '0x123')).toBe(false);
  });

  // SystemProgram.programId is a real exported @solana/web3.js constant (the well-known
  // all-ones address) — derived, not hand-typed, so a miscounted base58 string can't
  // silently make this test assert the wrong thing.
  const REAL_SOLANA_ADDRESS = SystemProgram.programId.toBase58();

  it('accepts a real, valid Solana address', () => {
    expect(isValidDestination('solana', REAL_SOLANA_ADDRESS)).toBe(true);
  });

  it('rejects a string with an invalid base58 character for Solana (0, O, I, l are all excluded)', () => {
    const withInvalidChar = '0' + REAL_SOLANA_ADDRESS.slice(1);
    expect(isValidDestination('solana', withInvalidChar)).toBe(false);
  });

  it('rejects an empty or whitespace-only destination for either chain kind', () => {
    expect(isValidDestination('evm', '')).toBe(false);
    expect(isValidDestination('evm', '   ')).toBe(false);
    expect(isValidDestination('solana', '')).toBe(false);
  });
});
