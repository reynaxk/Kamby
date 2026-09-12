import { describe, expect, it } from 'vitest';
import {
  CHAIN_REGISTRY,
  DEFAULT_CHAIN_ID,
  DEFAULT_CHAIN_SLUG,
  SUPPORTED_CHAIN_IDS,
  SUPPORTED_CHAIN_SLUGS,
  isChainSlug,
  slugForChainId,
  slugForIdentifier,
} from './chain-registry';

describe('CHAIN_REGISTRY', () => {
  it('knows Base and Arbitrum by their real chain ids and CAIP-2 identifiers', () => {
    expect(CHAIN_REGISTRY.base.numericId).toBe(8453);
    expect(CHAIN_REGISTRY.base.identifier).toBe('eip155:8453');
    expect(CHAIN_REGISTRY.arbitrum.numericId).toBe(42161);
    expect(CHAIN_REGISTRY.arbitrum.identifier).toBe('eip155:42161');
  });

  it('derives SUPPORTED_CHAIN_SLUGS/SUPPORTED_CHAIN_IDS from the same table', () => {
    expect(SUPPORTED_CHAIN_SLUGS).toEqual(['base', 'arbitrum']);
    expect(SUPPORTED_CHAIN_IDS).toEqual([8453, 42161]);
  });

  it('defaults to Base — the one chain every pre-multi-chain request implicitly meant', () => {
    expect(DEFAULT_CHAIN_SLUG).toBe('base');
    expect(DEFAULT_CHAIN_ID).toBe(8453);
  });
});

describe('isChainSlug', () => {
  it('accepts a known slug', () => {
    expect(isChainSlug('base')).toBe(true);
    expect(isChainSlug('arbitrum')).toBe(true);
  });

  it('rejects an unknown slug rather than guessing', () => {
    expect(isChainSlug('solana')).toBe(false);
    expect(isChainSlug('')).toBe(false);
  });
});

describe('slugForChainId', () => {
  it('resolves a known numeric chain id to its slug', () => {
    expect(slugForChainId(8453)).toBe('base');
    expect(slugForChainId(42161)).toBe('arbitrum');
  });

  it('returns null — never a guessed slug — for an unconfigured chain id', () => {
    expect(slugForChainId(1)).toBeNull();
  });
});

describe('slugForIdentifier', () => {
  it('resolves a known CAIP-2 identifier to its slug', () => {
    expect(slugForIdentifier('eip155:8453')).toBe('base');
    expect(slugForIdentifier('eip155:42161')).toBe('arbitrum');
  });

  it('returns null for an unconfigured identifier', () => {
    expect(slugForIdentifier('eip155:1')).toBeNull();
  });
});
