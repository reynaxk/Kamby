import { describe, expect, it } from 'vitest';
import { parseEnv } from '@kamby/domain';
import { ClientEnvSchema, ServerEnvSchema } from './env';

describe('web server env schema', () => {
  it('defaults NODE_ENV and API_BASE_URL when unset', () => {
    expect(parseEnv(ServerEnvSchema, {})).toEqual({
      NODE_ENV: 'development',
      API_BASE_URL: 'http://localhost:4000',
    });
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => parseEnv(ServerEnvSchema, { NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects a malformed API_BASE_URL rather than silently accepting it', () => {
    expect(() => parseEnv(ServerEnvSchema, { API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('accepts a real production API URL', () => {
    const result = parseEnv(ServerEnvSchema, { API_BASE_URL: 'https://api.example.com' });
    expect(result.API_BASE_URL).toBe('https://api.example.com');
  });
});

describe('web client env schema', () => {
  it('defaults NEXT_PUBLIC_API_BASE_URL, chain id, chain RPC URL, and the Jito endpoint when unset', () => {
    expect(parseEnv(ClientEnvSchema, {})).toEqual({
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
      NEXT_PUBLIC_CHAIN_ID: 8453,
      NEXT_PUBLIC_CHAIN_RPC_URL: 'https://mainnet.base.org',
      NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL: 'https://mainnet.block-engine.jito.wtf/api/v1/transactions',
    });
  });

  it('rejects a malformed NEXT_PUBLIC_API_BASE_URL rather than silently accepting it', () => {
    expect(() => parseEnv(ClientEnvSchema, { NEXT_PUBLIC_API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('coerces NEXT_PUBLIC_CHAIN_ID from a string env value to a number', () => {
    expect(parseEnv(ClientEnvSchema, { NEXT_PUBLIC_CHAIN_ID: '8453' }).NEXT_PUBLIC_CHAIN_ID).toBe(8453);
  });

  it('leaves NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID undefined rather than requiring it', () => {
    expect(parseEnv(ClientEnvSchema, {}).NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID).toBeUndefined();
  });

  it('leaves the Solana fields undefined rather than requiring them — Solana trading UI simply does not render without them', () => {
    const result = parseEnv(ClientEnvSchema, {});
    expect(result.NEXT_PUBLIC_PRIVY_APP_ID).toBeUndefined();
    expect(result.NEXT_PUBLIC_SOLANA_RPC_URL).toBeUndefined();
  });

  it('rejects a malformed NEXT_PUBLIC_SOLANA_RPC_URL rather than silently accepting it', () => {
    expect(() => parseEnv(ClientEnvSchema, { NEXT_PUBLIC_SOLANA_RPC_URL: 'not-a-url' })).toThrow();
  });

  it('overrides NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL to a specific regional endpoint when set', () => {
    const result = parseEnv(ClientEnvSchema, { NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL: 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions' });
    expect(result.NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL).toBe('https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions');
  });

  it('rejects a malformed NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL rather than silently accepting it', () => {
    expect(() => parseEnv(ClientEnvSchema, { NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL: 'not-a-url' })).toThrow();
  });
});
