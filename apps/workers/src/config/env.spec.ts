import { parseEnv } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/kamby',
  REDIS_URL: 'redis://localhost:6379',
  CHAIN_IDENTIFIER: 'eip155:8453',
  CHAIN_NAME: 'Base',
  CHAIN_NATIVE_SYMBOL: 'ETH',
  CHAIN_RPC_URL: 'https://base-mainnet.example.com/rpc',
};

describe('workers env schema', () => {
  it('accepts a complete, valid configuration', () => {
    expect(() => parseEnv(EnvSchema, valid)).not.toThrow();
  });

  it('fails clearly when the chain RPC URL is missing', () => {
    const { CHAIN_RPC_URL: _drop, ...rest } = valid;
    expect(() => parseEnv(EnvSchema, rest)).toThrowError(/CHAIN_RPC_URL/);
  });

  it('rejects a malformed RPC URL rather than silently accepting it', () => {
    expect(() => parseEnv(EnvSchema, { ...valid, CHAIN_RPC_URL: 'not-a-url' })).toThrow();
  });

  it('defaults TRADE_SWEEP_INTERVAL_SECONDS to 30 and accepts an override', () => {
    expect(parseEnv(EnvSchema, valid).TRADE_SWEEP_INTERVAL_SECONDS).toBe(30);
    expect(parseEnv(EnvSchema, { ...valid, TRADE_SWEEP_INTERVAL_SECONDS: '90' }).TRADE_SWEEP_INTERVAL_SECONDS).toBe(90);
  });

  it('requires nothing Solana-shaped when SOLANA_ENABLED is left at its default (false)', () => {
    const env = parseEnv(EnvSchema, valid);
    expect(env.SOLANA_ENABLED).toBe(false);
    expect(env.SOLANA_RPC_URL).toBeUndefined();
  });

  it('fails clearly when SOLANA_ENABLED is true but SOLANA_RPC_URL is missing', () => {
    expect(() => parseEnv(EnvSchema, { ...valid, SOLANA_ENABLED: 'true' })).toThrowError(/SOLANA_RPC_URL/);
  });

  it('accepts a fully-configured Solana deployment', () => {
    const env = parseEnv(EnvSchema, { ...valid, SOLANA_ENABLED: 'true', SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' });
    expect(env.SOLANA_ENABLED).toBe(true);
    expect(env.SOLANA_SWEEP_INTERVAL_SECONDS).toBe(30);
  });

  it('resolves a configured Solana fallback RPC URL instead of undefined', () => {
    const env = parseEnv(EnvSchema, {
      ...valid,
      SOLANA_ENABLED: 'true',
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      SOLANA_RPC_URL_FALLBACK: 'https://solana-fallback.example.com',
    });
    expect(env.SOLANA_RPC_URL_FALLBACK).toBe('https://solana-fallback.example.com');
  });

  it('defaults PUMPFUN_INGESTION_ENABLED to false', () => {
    expect(parseEnv(EnvSchema, valid).PUMPFUN_INGESTION_ENABLED).toBe(false);
  });

  it('fails clearly when PUMPFUN_INGESTION_ENABLED is true but SOLANA_ENABLED is not', () => {
    expect(() => parseEnv(EnvSchema, { ...valid, PUMPFUN_INGESTION_ENABLED: 'true' })).toThrowError(/PUMPFUN_INGESTION_ENABLED/);
  });

  it('accepts PUMPFUN_INGESTION_ENABLED when SOLANA_ENABLED is also true', () => {
    const env = parseEnv(EnvSchema, {
      ...valid,
      SOLANA_ENABLED: 'true',
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      PUMPFUN_INGESTION_ENABLED: 'true',
    });
    expect(env.PUMPFUN_INGESTION_ENABLED).toBe(true);
  });
});
