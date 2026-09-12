import { parseEnv } from '@kamby/domain';
import { EnvSchema, ValidatedEnvSchema, getConfiguredChains, getSolanaConfig, type Env } from './env';

/** A real generic function declaration (not an arrow lambda) so it satisfies
 *  getConfiguredChains' `<K extends keyof Env>(key: K) => Env[K]` parameter type — a plain
 *  `(key: keyof Env) => env[key]` arrow function only returns the flattened union `Env[keyof
 *  Env]`, which TypeScript won't narrow back to the per-call `Env[K]` it's asked for. */
function envGetter(env: Env) {
  return <K extends keyof Env>(key: K): Env[K] => env[key];
}

describe('API env schema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kamby',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a-test-secret-at-least-16-chars',
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: '8453',
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    LIFI_API_KEY: 'test-key',
    LIFI_INTEGRATOR: 'kamby-test',
    ONEINCH_API_KEY: 'test-key',
    PLATFORM_FEE_RECIPIENT_ADDRESS: '0x1234567890123456789012345678901234567890',
  };

  it('accepts a minimal valid configuration and fills in defaults', () => {
    const env = parseEnv(ValidatedEnvSchema, validBase);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.PLATFORM_FEE_BPS).toBe(50);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'DATABASE_URL'))).toThrowError(/DATABASE_URL/);
  });

  it('fails clearly when REDIS_URL is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'REDIS_URL'))).toThrowError(/REDIS_URL/);
  });

  it('fails clearly when JWT_SECRET is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'JWT_SECRET'))).toThrowError(/JWT_SECRET/);
  });

  it('fails clearly when JWT_SECRET is too short', () => {
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, JWT_SECRET: 'short' })).toThrowError(/JWT_SECRET/);
  });

  it('coerces PORT from a string env value to a number', () => {
    const env = parseEnv(ValidatedEnvSchema, { ...validBase, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  describe('multi-chain config (CHAINS + CHAIN_<SLUG>_*)', () => {
    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_ID', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_ID'))).toThrowError(/CHAIN_BASE_ID/);
    });

    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_RPC_URL', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_RPC_URL'))).toThrowError(/CHAIN_BASE_RPC_URL/);
    });

    it('rejects a malformed CHAIN_<SLUG>_RPC_URL', () => {
      expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, CHAIN_BASE_RPC_URL: 'not-a-url' })).toThrowError(/CHAIN_BASE_RPC_URL/);
    });

    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_USDC_ADDRESS', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_USDC_ADDRESS'))).toThrowError(/CHAIN_BASE_USDC_ADDRESS/);
    });

    it('rejects a malformed CHAIN_<SLUG>_USDC_ADDRESS', () => {
      expect(() =>
        parseEnv(ValidatedEnvSchema, { ...validBase, CHAIN_BASE_USDC_ADDRESS: 'not-an-address' }),
      ).toThrowError(/CHAIN_BASE_USDC_ADDRESS/);
    });

    it('rejects an unknown chain slug in CHAINS rather than silently ignoring it', () => {
      expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, CHAINS: 'base,solana' })).toThrowError(/solana/);
    });

    it('rejects a DEFAULT_CHAIN_SLUG that is not itself listed in CHAINS', () => {
      expect(() =>
        parseEnv(ValidatedEnvSchema, {
          ...validBase,
          DEFAULT_CHAIN_SLUG: 'arbitrum',
          CHAIN_ARBITRUM_ID: '42161',
          CHAIN_ARBITRUM_RPC_URL: 'https://arb1.arbitrum.io/rpc',
          CHAIN_ARBITRUM_USDC_ADDRESS: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        }),
      ).toThrowError(/DEFAULT_CHAIN_SLUG/);
    });

    it('accepts two fully-configured chains', () => {
      const env = parseEnv(ValidatedEnvSchema, {
        ...validBase,
        CHAINS: 'base,arbitrum',
        CHAIN_ARBITRUM_ID: '42161',
        CHAIN_ARBITRUM_RPC_URL: 'https://arb1.arbitrum.io/rpc',
        CHAIN_ARBITRUM_USDC_ADDRESS: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      });
      expect(getConfiguredChains(envGetter(env)).map((c) => c.slug)).toEqual(['base', 'arbitrum']);
    });

    it("does not require Arbitrum's variables when only base is listed in CHAINS", () => {
      expect(() => parseEnv(ValidatedEnvSchema, validBase)).not.toThrow();
    });
  });

  describe('getConfiguredChains', () => {
    it('returns exactly one entry per slug in CHAINS, with the right fields resolved', () => {
      const env = parseEnv(ValidatedEnvSchema, validBase);
      const chains = getConfiguredChains(envGetter(env));
      expect(chains).toEqual([
        { slug: 'base', chainId: 8453, rpcUrl: 'https://mainnet.base.org', usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      ]);
    });
  });

  describe('Solana config (SOLANA_ENABLED + SOLANA_*)', () => {
    it('requires nothing Solana-shaped when SOLANA_ENABLED is left at its default (false)', () => {
      expect(() => parseEnv(ValidatedEnvSchema, validBase)).not.toThrow();
      const env = parseEnv(ValidatedEnvSchema, validBase);
      expect(getSolanaConfig(envGetter(env))).toBeNull();
    });

    const solanaBase = {
      ...validBase,
      SOLANA_ENABLED: 'true',
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      SOLANA_TREASURY_USDC_ATA: 'FakeAtaAddressForTestingOnly1111111111111',
      SOLANA_TOPUP_FUNDING_SECRET_KEY: 'fake-base58-secret-key-for-testing-only',
    };

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_RPC_URL is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_RPC_URL'))).toThrowError(/SOLANA_RPC_URL/);
    });

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_TREASURY_USDC_ATA is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_TREASURY_USDC_ATA'))).toThrowError(/SOLANA_TREASURY_USDC_ATA/);
    });

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_TOPUP_FUNDING_SECRET_KEY is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_TOPUP_FUNDING_SECRET_KEY'))).toThrowError(
        /SOLANA_TOPUP_FUNDING_SECRET_KEY/,
      );
    });

    it('defaults SOLANA_JUPITER_PLATFORM_FEE_BPS to 50 (0.50%), matching the EVM side', () => {
      const env = parseEnv(ValidatedEnvSchema, solanaBase);
      expect(env.SOLANA_JUPITER_PLATFORM_FEE_BPS).toBe(50);
    });

    it('getSolanaConfig resolves every field once SOLANA_ENABLED is true and fully configured', () => {
      const env = parseEnv(ValidatedEnvSchema, solanaBase);
      expect(getSolanaConfig(envGetter(env))).toEqual({
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        treasuryUsdcAta: 'FakeAtaAddressForTestingOnly1111111111111',
        jupiterPlatformFeeBps: 50,
        newWalletTopupSol: 0.01,
        topupFundingSecretKey: 'fake-base58-secret-key-for-testing-only',
      });
    });
  });

  it('fails clearly when LIFI_API_KEY is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'LIFI_API_KEY'))).toThrowError(/LIFI_API_KEY/);
  });

  it('fails clearly when LIFI_INTEGRATOR is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'LIFI_INTEGRATOR'))).toThrowError(/LIFI_INTEGRATOR/);
  });

  it('fails clearly when ONEINCH_API_KEY is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'ONEINCH_API_KEY'))).toThrowError(/ONEINCH_API_KEY/);
  });

  it('fails clearly when PLATFORM_FEE_RECIPIENT_ADDRESS is missing or malformed', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'PLATFORM_FEE_RECIPIENT_ADDRESS'))).toThrowError(
      /PLATFORM_FEE_RECIPIENT_ADDRESS/,
    );
    expect(() =>
      parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_RECIPIENT_ADDRESS: 'not-an-address' }),
    ).toThrowError(/PLATFORM_FEE_RECIPIENT_ADDRESS/);
  });

  it('defaults PLATFORM_FEE_BPS to 50 (0.50%) and accepts an override within range', () => {
    expect(parseEnv(ValidatedEnvSchema, validBase).PLATFORM_FEE_BPS).toBe(50);
    expect(parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '75' }).PLATFORM_FEE_BPS).toBe(75);
  });

  it('rejects a PLATFORM_FEE_BPS outside the sane configured range', () => {
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '-1' })).toThrow();
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '10000' })).toThrow();
  });
});

// Sanity check that the bare (unrefined) EnvSchema still validates the fields that don't
// depend on cross-field chain configuration — ValidatedEnvSchema above covers the rest.
describe('EnvSchema (unrefined)', () => {
  it('fails clearly when DATABASE_URL is missing, independent of chain config', () => {
    expect(() => parseEnv(EnvSchema, { REDIS_URL: 'redis://localhost:6379' })).toThrowError(/DATABASE_URL/);
  });
});

function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}
