import { describe, expect, it } from 'vitest';
import {
  CHAIN_REGISTRY,
  DEFAULT_CHAIN_ID,
  DEFAULT_CHAIN_SLUG,
  SUPPORTED_CHAIN_IDS,
  SUPPORTED_CHAIN_SLUGS,
  identifierForChainId,
  isChainSlug,
  slugForChainId,
  slugForIdentifier,
} from './chain-registry';

describe('CHAIN_REGISTRY', () => {
  it('knows Base, Arbitrum, BNB Chain, and Ethereum by their real chain ids and CAIP-2 identifiers', () => {
    expect(CHAIN_REGISTRY.base.numericId).toBe(8453);
    expect(CHAIN_REGISTRY.base.identifier).toBe('eip155:8453');
    expect(CHAIN_REGISTRY.arbitrum.numericId).toBe(42161);
    expect(CHAIN_REGISTRY.arbitrum.identifier).toBe('eip155:42161');
    expect(CHAIN_REGISTRY.bnb.numericId).toBe(56);
    expect(CHAIN_REGISTRY.bnb.identifier).toBe('eip155:56');
    expect(CHAIN_REGISTRY.ethereum.numericId).toBe(1);
    expect(CHAIN_REGISTRY.ethereum.identifier).toBe('eip155:1');
  });

  it('derives SUPPORTED_CHAIN_SLUGS/SUPPORTED_CHAIN_IDS from the same table', () => {
    expect(SUPPORTED_CHAIN_SLUGS).toEqual(['base', 'arbitrum', 'bnb', 'ethereum']);
    expect(SUPPORTED_CHAIN_IDS).toEqual([8453, 42161, 56, 1]);
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
    expect(isChainSlug('ethereum')).toBe(true);
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
    expect(slugForChainId(1)).toBe('ethereum');
  });

  // 137 (Polygon) is deliberately still unregistered — a real negative case, not just "any
  // number that happens not to be a key today."
  it('returns null — never a guessed slug — for an unconfigured chain id', () => {
    expect(slugForChainId(137)).toBeNull();
  });
});

describe('slugForIdentifier', () => {
  it('resolves a known CAIP-2 identifier to its slug', () => {
    expect(slugForIdentifier('eip155:8453')).toBe('base');
    expect(slugForIdentifier('eip155:42161')).toBe('arbitrum');
    expect(slugForIdentifier('eip155:1')).toBe('ethereum');
  });

  it('returns null for an unconfigured identifier', () => {
    expect(slugForIdentifier('eip155:137')).toBeNull();
  });
});

describe('identifierForChainId', () => {
  it('resolves a known numeric chain id to its real CAIP-2 identifier', () => {
    expect(identifierForChainId(8453)).toBe('eip155:8453');
    expect(identifierForChainId(42161)).toBe('eip155:42161');
    expect(identifierForChainId(1)).toBe('eip155:1');
  });

  it('returns null — never a guessed identifier — for an unconfigured chain id', () => {
    expect(identifierForChainId(137)).toBeNull();
  });
});
